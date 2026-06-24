#!/usr/bin/env bash
# Day-1 capstone — runs the ENTIRE agent loop end-to-end over HTTP and proves the core gate.
# enroll -> workflow.create -> checkin(start) -> artifact.upload -> evidence-gated fact + learning
# -> fact.query/learning.query -> objective.publish -> key_result.update -> milestone.achieve
# -> checkin(complete). Also asserts an evidence-less medium write is REJECTED.
#
# Run from the repo root in Git Bash:  bash testing/demo_day1.sh
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
API="http://127.0.0.1:8787"

fails=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; fails=$((fails + 1)); }

echo "=== MemOS Day-1 end-to-end demo ==="

PROJ="project.demo"
CODE="enr_code_demo1_$(date +%s)_$$"

docker compose exec -T db psql -U postgres -d memos -q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
insert into orgs (id, name) values ('org','Demo Org') on conflict (id) do nothing;
insert into teams (id, org_id, name) values ('team.demo','org','Demo Team') on conflict (id) do nothing;
insert into projects (id, team_id, org_id, name, okrs_required) values ('$PROJ','team.demo','org','Demo Project',false) on conflict (id) do nothing;
insert into enrollment_codes (code, team_id, org_id, role, scopes) values ('$CODE','team.demo','org','manager','["$PROJ"]'::jsonb);
SQL
[ $? -eq 0 ] && pass "seeded project + code" || fail "seed"

STARTED=0
if curl -sf "$API/health" >/dev/null 2>&1; then
  pass "gateway already running"
else
  echo "starting gateway (tsx, no watch)..."
  pnpm --filter @memos/api exec tsx src/server.ts >/tmp/memos-gw.log 2>&1 &
  STARTED=1
  for _ in $(seq 1 30); do curl -sf "$API/health" >/dev/null 2>&1 && break; sleep 1; done
  curl -sf "$API/health" >/dev/null 2>&1 && pass "gateway started" || fail "gateway started"
fi
cleanup_gw() {
  if [ "$STARTED" -eq 1 ]; then
    local pid
    pid=$(netstat -ano 2>/dev/null | grep -E ':8787[^0-9]' | grep -i LISTENING | awk '{print $NF}' | head -1)
    [ -n "$pid" ] && taskkill //F //T //PID "$pid" >/dev/null 2>&1
  fi
}
trap cleanup_gw EXIT

TOK=$(curl -s -X POST "$API/v1/intent/agent.enroll" -H 'content-type: application/json' \
  -d "{\"code\":\"$CODE\",\"display_name\":\"demo1-agent\"}" | sed -n 's/.*"raw":"\(syn_[^"]*\)".*/\1/p')
echo "$TOK" | grep -q '^syn_' && pass "1. enrolled" || fail "enroll"
auth=(-H "authorization: Bearer $TOK" -H 'content-type: application/json')

BD=$(curl -s -X POST "$API/v1/intent/workflow.create" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"workflow_class\":\"investigation\",\"title\":\"day1 loop\"}" \
  | sed -n 's/.*"bd_id":"\(memos-[^"]*\)".*/\1/p')
echo "$BD" | grep -qE '^memos-' && pass "2. workflow.create -> $BD" || fail "workflow.create"

curl -s -X POST "$API/v1/intent/checkin" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"bd_id\":\"$BD\",\"status\":\"start\",\"current_task\":\"investigating\"}" \
  | grep -q '"checkin_id"' && pass "3. checkin start" || fail "checkin start"

ART=$(curl -s -X POST "$API/v1/intent/artifact.upload" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"bd_id\":\"$BD\",\"kind\":\"log\",\"mime_type\":\"text/plain\",\"content_base64\":\"$(printf 'measured p99=180ms' | base64 -w0)\"}" \
  | sed -n 's/.*"artifact_id":"\([0-9a-f-]*\)".*/\1/p')
[ -n "$ART" ] && pass "4. artifact.upload -> $ART" || fail "artifact.upload"

# Evidence-less medium write MUST be rejected (the core invariant) -> HTTP 400.
GATE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/intent/fact.record" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"bd_id\":\"$BD\",\"facts\":[{\"claim\":\"p99 improved\",\"confidence\":\"medium\"}]}")
[ "$GATE" = "400" ] && pass "5. evidence-less medium fact rejected (400)" || fail "evidence gate (got HTTP $GATE)"

# Evidence-backed fact + a reusable learning.
curl -s -X POST "$API/v1/intent/fact.record" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"bd_id\":\"$BD\",\"facts\":[{\"claim\":\"p99 latency dropped to 180ms after warmup\",\"confidence\":\"medium\",\"evidence_artifact_id\":\"$ART\"}]}" \
  | grep -q '"fact_ids"' && pass "6. evidence-backed fact recorded" || fail "fact.record"
curl -s -X POST "$API/v1/intent/learning.record" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"bd_id\":\"$BD\",\"learnings\":[{\"claim\":\"warmup requests cut p99 cold-start latency sharply\",\"applies_to\":[\"vllm-deployment\"],\"confidence\":\"medium\",\"non_obvious_marker\":\"counterintuitive: warmup helps tail not mean\",\"evidence_artifact_id\":\"$ART\"}]}" \
  | grep -q '"learning_ids"' && pass "7. evidence+marker learning recorded" || fail "learning.record"

# Query both back.
curl -s -X POST "$API/v1/intent/fact.query" "${auth[@]}" -d "{\"project_id\":\"$PROJ\",\"query\":\"latency\"}" \
  | grep -q "p99 latency dropped" && pass "8. fact.query finds it" || fail "fact.query"
curl -s -X POST "$API/v1/intent/learning.query" "${auth[@]}" -d "{\"project_id\":\"$PROJ\",\"query\":\"warmup\"}" \
  | grep -q "warmup requests cut" && pass "9. learning.query finds it" || fail "learning.query"

# Publish an OKR, move its KR, achieve it.
PUB=$(curl -s -X POST "$API/v1/intent/objective.publish" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"bd_id\":\"$BD\",\"title\":\"Cut p99\",\"milestones\":[{\"title\":\"p99<=200\",\"metric_target\":200,\"metric_current\":400,\"metric_direction\":\"down\"}]}")
OBJ=$(echo "$PUB" | sed -n 's/.*"objective_id":"\([0-9a-f-]*\)".*/\1/p')
MS=$(echo "$PUB" | sed -n 's/.*"milestone_ids":\["\([0-9a-f-]*\)".*/\1/p')
[ -n "$OBJ" ] && pass "10. objective.publish -> $OBJ" || fail "objective.publish (got: $PUB)"
curl -s -X POST "$API/v1/intent/key_result.update" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"milestone_id\":\"$MS\",\"metric_current\":200}" \
  | grep -q '"progress":1' && pass "11. key_result.update to target -> progress 1" || fail "key_result.update"
curl -s -X POST "$API/v1/intent/milestone.achieve" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"bd_id\":\"$BD\",\"milestone_id\":\"$MS\",\"claim\":\"p99 at 200ms\",\"confidence\":\"medium\",\"evidence_artifact_id\":\"$ART\"}" \
  | grep -q '"status":"achieved"' && pass "12. milestone.achieve (evidence-backed)" || fail "milestone.achieve"

# Close the run.
curl -s -X POST "$API/v1/intent/checkin" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"bd_id\":\"$BD\",\"status\":\"complete\",\"current_task\":\"done\"}" \
  | grep -q '"checkin_id"' && pass "13. checkin complete (run closed)" || fail "checkin complete"

# Cleanup.
docker compose exec -T db psql -U postgres -d memos -q >/dev/null 2>&1 <<SQL
delete from facts where bd_id='$BD';
delete from learnings where bd_id='$BD';
delete from milestones where objective_id='$OBJ';
delete from objectives where id='$OBJ';
delete from checkins where bd_id='$BD';
delete from artifacts where bd_id='$BD';
delete from workflow_runs where bd_id='$BD';
delete from agents where display_name='demo1-agent';
delete from enrollment_codes where code='$CODE';
SQL

echo "=== Day-1 demo summary ==="
if [ "$fails" -eq 0 ]; then echo "FULL LOOP GREEN — Day 1 done"; exit 0; else echo "$fails CHECK(S) FAILED"; exit 1; fi

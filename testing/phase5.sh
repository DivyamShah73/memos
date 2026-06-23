#!/usr/bin/env bash
# Phase 5 manual test — OKRs, over HTTP. Self-contained: publishes an objective with one key
# result (target 90, up), moves it to 45 (→ progress 0.5), reads the rollup back, then achieves
# a milestone and confirms the status flip + progress.
#
# Run from the repo root in Git Bash:  bash testing/phase5.sh
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
API="http://127.0.0.1:8787"

fails=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; fails=$((fails + 1)); }

echo "=== MemOS Phase 5 ==="

PROJ="project.demo"
CODE="enr_code_phase5_$(date +%s)_$$"

docker compose exec -T db psql -U postgres -d memos -q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
insert into orgs (id, name) values ('org','Demo Org') on conflict (id) do nothing;
insert into teams (id, org_id, name) values ('team.demo','org','Demo Team') on conflict (id) do nothing;
insert into projects (id, team_id, org_id, name, okrs_required) values ('$PROJ','team.demo','org','Demo Project',false) on conflict (id) do nothing;
insert into enrollment_codes (code, team_id, org_id, scopes) values ('$CODE','team.demo','org','["$PROJ"]'::jsonb);
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
  -d "{\"code\":\"$CODE\",\"display_name\":\"phase5-agent\"}" | sed -n 's/.*"raw":"\(syn_[^"]*\)".*/\1/p')
echo "$TOK" | grep -q '^syn_' && pass "enrolled" || fail "enroll"
auth=(-H "authorization: Bearer $TOK" -H 'content-type: application/json')

BD=$(curl -s -X POST "$API/v1/intent/workflow.create" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"workflow_class\":\"investigation\",\"title\":\"phase5 run\"}" \
  | sed -n 's/.*"bd_id":"\(memos-[^"]*\)".*/\1/p')
echo "$BD" | grep -qE '^memos-' && pass "workflow.create -> $BD" || fail "workflow.create"

# Publish an objective with one key result (target 90, current 0, higher-is-better) + one plain milestone.
PUB=$(curl -s -X POST "$API/v1/intent/objective.publish" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"bd_id\":\"$BD\",\"title\":\"Reach 90\",\"milestones\":[{\"title\":\"hit 90\",\"metric_target\":90,\"metric_current\":0,\"metric_direction\":\"up\"},{\"title\":\"ship it\"}]}")
OBJ=$(echo "$PUB" | sed -n 's/.*"objective_id":"\([0-9a-f-]*\)".*/\1/p')
MS=$(echo "$PUB" | sed -n 's/.*"milestone_ids":\["\([0-9a-f-]*\)".*/\1/p')        # first id = the KR
PLAIN=$(echo "$PUB" | sed -n 's/.*"milestone_ids":\["[0-9a-f-]*","\([0-9a-f-]*\)".*/\1/p')  # second = plain
[ -n "$OBJ" ] && [ -n "$MS" ] && pass "objective.publish -> $OBJ (KR $MS)" || fail "objective.publish (got: $PUB)"

# Move the KR to 45 of 90 → progress 0.5.
KRU=$(curl -s -X POST "$API/v1/intent/key_result.update" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"milestone_id\":\"$MS\",\"metric_current\":45}")
echo "$KRU" | grep -q '"progress":0.5' && pass "key_result.update 45/90 -> progress 0.5" || fail "key_result.update (got: $KRU)"

# Query the objective: one KR at 0.5 + one plain pending milestone (0) → objective progress 0.25.
OQ=$(curl -s -X POST "$API/v1/intent/objective.query" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"objective_id\":\"$OBJ\"}")
echo "$OQ" | grep -q '"progress":0.25' && pass "objective.query rollup -> 0.25" || fail "objective.query (got: $OQ)"

# Achieve the plain milestone (low confidence, no evidence required).
ACH=$(curl -s -X POST "$API/v1/intent/milestone.achieve" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"bd_id\":\"$BD\",\"milestone_id\":\"$PLAIN\",\"claim\":\"shipped\",\"confidence\":\"low\"}")
echo "$ACH" | grep -q '"status":"achieved"' && pass "milestone.achieve -> achieved" || fail "milestone.achieve (got: $ACH)"

# A medium achieve with no evidence must be rejected (the gate holds on OKRs too) -> HTTP 400.
GATE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/intent/milestone.achieve" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"bd_id\":\"$BD\",\"milestone_id\":\"$MS\",\"claim\":\"hit target\",\"confidence\":\"medium\"}")
[ "$GATE" = "400" ] && pass "medium achieve without evidence rejected (400)" || fail "evidence gate (got HTTP $GATE)"

# Cleanup (milestones before objectives — FK).
docker compose exec -T db psql -U postgres -d memos -q >/dev/null 2>&1 <<SQL
delete from milestones where objective_id='$OBJ';
delete from objectives where id='$OBJ';
delete from workflow_runs where bd_id='$BD';
delete from agents where display_name='phase5-agent';
delete from enrollment_codes where code='$CODE';
SQL

echo "=== Phase 5 summary ==="
if [ "$fails" -eq 0 ]; then echo "ALL CHECKS PASS"; exit 0; else echo "$fails CHECK(S) FAILED"; exit 1; fi

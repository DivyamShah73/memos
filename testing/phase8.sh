#!/usr/bin/env bash
# Phase 8 gateway-side test — provenance trace + brief authoring round-trip + trust leaderboard.
# Self-contained: builds a full lineage via the API (objective ← run ← artifact ← evidence-backed
# learning), then traces it; authors a brief at a 2nd agent and confirms that agent receives it.
#
# Run from the repo root in Git Bash:  bash testing/phase8.sh
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
API="http://127.0.0.1:8787"

fails=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; fails=$((fails + 1)); }

echo "=== MemOS Phase 8 ==="

PROJ="project.demo"
CODE="enr_code_phase8_$(date +%s)_$$"
CODE2="enr_code_phase8b_$(date +%s)_$$"

docker compose exec -T db psql -U postgres -d memos -q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
insert into orgs (id, name) values ('org','Demo Org') on conflict (id) do nothing;
insert into teams (id, org_id, name) values ('team.demo','org','Demo Team') on conflict (id) do nothing;
insert into projects (id, team_id, org_id, name, okrs_required) values ('$PROJ','team.demo','org','Demo Project',false) on conflict (id) do nothing;
insert into enrollment_codes (code, team_id, org_id, role, scopes) values ('$CODE','team.demo','org','manager','["$PROJ"]'::jsonb);
insert into enrollment_codes (code, team_id, org_id, role, scopes) values ('$CODE2','team.demo','org','manager','["$PROJ"]'::jsonb);
SQL
[ $? -eq 0 ] && pass "seeded project + codes" || fail "seed"

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

ENR=$(curl -s -X POST "$API/v1/intent/agent.enroll" -H 'content-type: application/json' \
  -d "{\"code\":\"$CODE\",\"display_name\":\"phase8-op\"}")
TOK=$(echo "$ENR" | sed -n 's/.*"raw":"\(syn_[^"]*\)".*/\1/p')
ENR2=$(curl -s -X POST "$API/v1/intent/agent.enroll" -H 'content-type: application/json' \
  -d "{\"code\":\"$CODE2\",\"display_name\":\"phase8-target\"}")
TOK2=$(echo "$ENR2" | sed -n 's/.*"raw":"\(syn_[^"]*\)".*/\1/p')
TARGET=$(echo "$ENR2" | sed -n 's/.*"agent_id":"\([^"]*\)".*/\1/p')
echo "$TOK" | grep -q '^syn_' && echo "$TOK2" | grep -q '^syn_' && pass "enrolled op + target ($TARGET)" || fail "enroll"
auth=(-H "authorization: Bearer $TOK" -H 'content-type: application/json')

# Build the lineage: run0 → objective → bound run1 → artifact → evidence-backed learning.
BD0=$(curl -s -X POST "$API/v1/intent/workflow.create" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"workflow_class\":\"investigation\",\"title\":\"p8 seed run\"}" \
  | sed -n 's/.*"bd_id":"\(memos-[^"]*\)".*/\1/p')
OBJ=$(curl -s -X POST "$API/v1/intent/objective.publish" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"bd_id\":\"$BD0\",\"title\":\"Phase8 objective\"}" \
  | sed -n 's/.*"objective_id":"\([0-9a-f-]*\)".*/\1/p')
BD1=$(curl -s -X POST "$API/v1/intent/workflow.create" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"workflow_class\":\"benchmark\",\"title\":\"p8 bound run\",\"target_objective_id\":\"$OBJ\"}" \
  | sed -n 's/.*"bd_id":"\(memos-[^"]*\)".*/\1/p')
ART=$(curl -s -X POST "$API/v1/intent/artifact.upload" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"bd_id\":\"$BD1\",\"kind\":\"benchmark\",\"mime_type\":\"text/plain\",\"content_base64\":\"$(printf 'p8 evidence' | base64 -w0)\"}" \
  | sed -n 's/.*"artifact_id":"\([0-9a-f-]*\)".*/\1/p')
LID=$(curl -s -X POST "$API/v1/intent/learning.record" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"bd_id\":\"$BD1\",\"learnings\":[{\"claim\":\"phase8 traced learning\",\"applies_to\":[\"x\"],\"confidence\":\"medium\",\"non_obvious_marker\":\"a sufficiently long marker here\",\"evidence_artifact_id\":\"$ART\"}]}" \
  | sed -n 's/.*"learning_ids":\["\([0-9a-f-]*\)".*/\1/p')
[ -n "$OBJ" ] && [ -n "$ART" ] && [ -n "$LID" ] && pass "built lineage (obj/run/artifact/learning)" || fail "lineage build"

# Trace it — the chain must include artifact, run, objective, and agent nodes.
TR=$(curl -s -X POST "$API/v1/intent/provenance.trace" "${auth[@]}" -d "{\"project_id\":\"$PROJ\",\"learning_id\":\"$LID\"}")
for t in artifact run objective agent; do
  echo "$TR" | grep -q "\"type\":\"$t\"" && pass "provenance chain has $t node" || fail "provenance missing $t (got: $TR)"
done

# learning.list returns the learning.
curl -s -X POST "$API/v1/intent/learning.list" "${auth[@]}" -d "{\"project_id\":\"$PROJ\"}" \
  | grep -q "phase8 traced learning" && pass "learning.list returns it" || fail "learning.list"

# brief.create round-trip: op authors a brief at the target agent → target fetches it.
TITLE="p8-brief-$$"
curl -s -X POST "$API/v1/intent/brief.create" "${auth[@]}" \
  -d "{\"target_kind\":\"agent\",\"target_id\":\"$TARGET\",\"title\":\"$TITLE\",\"body\":\"cap batch size at 32\"}" \
  | grep -q '"brief_id"' && pass "brief.create ok" || fail "brief.create"
curl -s -X POST "$API/v1/intent/brief.fetch" -H "authorization: Bearer $TOK2" -H 'content-type: application/json' \
  -d "{\"project_id\":\"$PROJ\"}" | grep -q "$TITLE" && pass "authored brief reached the target agent" || fail "brief round-trip"

# trust.leaderboard returns agents.
curl -s -X POST "$API/v1/intent/trust.leaderboard" "${auth[@]}" -d "{\"project_id\":\"$PROJ\"}" \
  | grep -q '"trust_score"' && pass "trust.leaderboard returns agents" || fail "trust.leaderboard"

# Cleanup.
docker compose exec -T db psql -U postgres -d memos -q >/dev/null 2>&1 <<SQL
delete from briefs where author_id in (select id from agents where display_name in ('phase8-op','phase8-target')) or target_id in (select id from agents where display_name='phase8-target');
delete from learnings where bd_id in ('$BD0','$BD1');
delete from artifacts where bd_id in ('$BD0','$BD1');
delete from workflow_runs where bd_id in ('$BD0','$BD1') or target_objective_id='$OBJ';
delete from milestones where objective_id='$OBJ';
delete from objectives where id='$OBJ';
delete from agents where display_name in ('phase8-op','phase8-target');
delete from enrollment_codes where code in ('$CODE','$CODE2');
SQL

echo "=== Phase 8 summary ==="
if [ "$fails" -eq 0 ]; then echo "ALL CHECKS PASS"; exit 0; else echo "$fails CHECK(S) FAILED"; exit 1; fi

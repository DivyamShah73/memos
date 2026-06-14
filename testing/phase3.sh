#!/usr/bin/env bash
# Phase 3 manual test — artifacts + evidence-gated writes (THE core invariant), over HTTP.
# Runs the agent loop: enroll -> workflow -> upload evidence -> record facts/learnings,
# and PROVES the gate: a medium fact with NO evidence is rejected; with evidence it's
# accepted. If the no-evidence medium write succeeds, the product is broken.
#
# Run from the repo root in Git Bash:  bash testing/phase3.sh
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
API="http://127.0.0.1:8787"

fails=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; fails=$((fails + 1)); }

echo "=== MemOS Phase 3 ==="

PROJ="project.demo"
CODE="enr_code_phase3_$(date +%s)_$$"

# 1. Seed org/team/(non-okrs)project + a fresh code.
docker compose exec -T db psql -U postgres -d memos -q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
insert into orgs (id, name) values ('org','Demo Org') on conflict (id) do nothing;
insert into teams (id, org_id, name) values ('team.demo','org','Demo Team') on conflict (id) do nothing;
insert into projects (id, team_id, name, okrs_required) values ('$PROJ','team.demo','Demo Project',false) on conflict (id) do nothing;
insert into enrollment_codes (code, team_id, scopes) values ('$CODE','team.demo','["$PROJ"]'::jsonb);
SQL
[ $? -eq 0 ] && pass "seeded project + code" || fail "seed"

# 2. Ensure the gateway is up (self-start, robust cleanup).
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

# 3. Enroll + open a workflow.
TOK=$(curl -s -X POST "$API/v1/intent/agent.enroll" -H 'content-type: application/json' \
  -d "{\"code\":\"$CODE\",\"display_name\":\"phase3-agent\"}" | sed -n 's/.*"raw":"\(syn_[^"]*\)".*/\1/p')
echo "$TOK" | grep -q '^syn_' && pass "enrolled" || fail "enroll"
auth=(-H "authorization: Bearer $TOK" -H 'content-type: application/json')

BD=$(curl -s -X POST "$API/v1/intent/workflow.create" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"workflow_class\":\"investigation\",\"title\":\"phase3 run\"}" \
  | sed -n 's/.*"bd_id":"\(memos-[^"]*\)".*/\1/p')
echo "$BD" | grep -qE '^memos-' && pass "workflow.create -> $BD" || fail "workflow.create"

# 4. Upload evidence -> artifact_id.
B64=$(printf 'run022 vs run014: 92.6%% pass rate' | base64 -w0)
ART=$(curl -s -X POST "$API/v1/intent/artifact.upload" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"bd_id\":\"$BD\",\"kind\":\"log\",\"description\":\"comparison\",\"mime_type\":\"text/plain\",\"content_base64\":\"$B64\"}" \
  | sed -n 's/.*"artifact_id":"\([0-9a-f-]*\)".*/\1/p')
echo "$ART" | grep -qE '^[0-9a-f-]{36}$' && pass "artifact.upload -> ${ART:0:8}..." || fail "artifact.upload"

# 5. THE GATE — medium fact WITHOUT evidence must be REJECTED.
A=$(curl -s -X POST "$API/v1/intent/fact.record" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"bd_id\":\"$BD\",\"facts\":[{\"claim\":\"x\",\"confidence\":\"medium\"}]}")
if echo "$A" | grep -q '"ok":false'; then
  pass "medium fact WITHOUT evidence rejected (the gate holds)"
else
  fail "GATE BROKEN: medium fact with no evidence was accepted -> $A"
fi

# 6. Medium fact WITH evidence must be ACCEPTED.
B=$(curl -s -X POST "$API/v1/intent/fact.record" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"bd_id\":\"$BD\",\"facts\":[{\"claim\":\"D7 dropped 11pp\",\"confidence\":\"medium\",\"evidence_artifact_id\":\"$ART\"}]}")
echo "$B" | grep -q '"ok":true' && pass "medium fact WITH evidence accepted" || fail "evidence-backed fact (got: $B)"

# 7. Learning with marker + evidence accepted.
L=$(curl -s -X POST "$API/v1/intent/learning.record" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"bd_id\":\"$BD\",\"learnings\":[{\"claim\":\"3 epochs > 5 at low samples\",\"applies_to\":[\"fine-tuning\",\"epochs\"],\"confidence\":\"medium\",\"non_obvious_marker\":\"standard guidance says 3-5 epochs uniformly; sub-200 samples regress at 5\",\"evidence_artifact_id\":\"$ART\"}]}")
echo "$L" | grep -q '"ok":true' && pass "evidence+marker learning accepted" || fail "learning (got: $L)"

# 8. Bytes are NOT in Postgres — only metadata.
META=$(docker compose exec -T db psql -U postgres -d memos -t -A \
  -c "select size_bytes, length(bucket_path) from artifacts where id='$ART';" 2>/dev/null | tr -d '[:space:]')
[ -n "$META" ] && pass "artifact metadata stored (size+bucket_path: $META)" || fail "artifact metadata"
HASBYTEA=$(docker compose exec -T db psql -U postgres -d memos -t -A \
  -c "select count(*) from information_schema.columns where table_name='artifacts' and data_type='bytea';" 2>/dev/null | tr -d '[:space:]')
[ "$HASBYTEA" = "0" ] && pass "no bytea column on artifacts (bytes not in Postgres)" || fail "artifacts has a bytea column"

# Cleanup this run's rows.
docker compose exec -T db psql -U postgres -d memos -q >/dev/null 2>&1 <<SQL
delete from facts where bd_id='$BD';
delete from learnings where bd_id='$BD';
delete from artifacts where bd_id='$BD';
delete from workflow_runs where bd_id='$BD';
delete from agents where display_name='phase3-agent';
delete from enrollment_codes where code='$CODE';
SQL

echo "=== Phase 3 summary ==="
if [ "$fails" -eq 0 ]; then echo "ALL CHECKS PASS"; exit 0; else echo "$fails CHECK(S) FAILED"; exit 1; fi

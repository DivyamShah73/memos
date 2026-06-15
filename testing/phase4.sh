#!/usr/bin/env bash
# Phase 4 manual test — query (find what's stored), over HTTP. Self-contained: records a
# learning + fact with a known keyword, then proves keyword search returns the match and an
# unrelated query does not.
#
# Run from the repo root in Git Bash:  bash testing/phase4.sh
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
API="http://127.0.0.1:8787"

fails=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; fails=$((fails + 1)); }

echo "=== MemOS Phase 4 ==="

PROJ="project.demo"
CODE="enr_code_phase4_$(date +%s)_$$"

docker compose exec -T db psql -U postgres -d memos -q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
insert into orgs (id, name) values ('org','Demo Org') on conflict (id) do nothing;
insert into teams (id, org_id, name) values ('team.demo','org','Demo Team') on conflict (id) do nothing;
insert into projects (id, team_id, name, okrs_required) values ('$PROJ','team.demo','Demo Project',false) on conflict (id) do nothing;
insert into enrollment_codes (code, team_id, scopes) values ('$CODE','team.demo','["$PROJ"]'::jsonb);
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
  -d "{\"code\":\"$CODE\",\"display_name\":\"phase4-agent\"}" | sed -n 's/.*"raw":"\(syn_[^"]*\)".*/\1/p')
echo "$TOK" | grep -q '^syn_' && pass "enrolled" || fail "enroll"
auth=(-H "authorization: Bearer $TOK" -H 'content-type: application/json')

BD=$(curl -s -X POST "$API/v1/intent/workflow.create" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"workflow_class\":\"investigation\",\"title\":\"phase4 run\"}" \
  | sed -n 's/.*"bd_id":"\(memos-[^"]*\)".*/\1/p')
echo "$BD" | grep -qE '^memos-' && pass "workflow.create -> $BD" || fail "workflow.create"

# Record a low-confidence learning + fact with a known keyword (no evidence needed for low).
curl -s -X POST "$API/v1/intent/learning.record" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"bd_id\":\"$BD\",\"learnings\":[{\"claim\":\"vllm gpu deployment tuning for throughput\",\"applies_to\":[\"vllm-deployment\"],\"confidence\":\"low\"}]}" >/dev/null
curl -s -X POST "$API/v1/intent/fact.record" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"bd_id\":\"$BD\",\"facts\":[{\"claim\":\"vllm request latency dropped 30 percent\",\"confidence\":\"low\"}]}" >/dev/null
pass "recorded a learning + fact"

# Keyword query returns the match.
LQ=$(curl -s -X POST "$API/v1/intent/learning.query" "${auth[@]}" -d "{\"project_id\":\"$PROJ\",\"query\":\"vllm\"}")
echo "$LQ" | grep -q "vllm gpu deployment" && pass "learning.query 'vllm' returns the match" || fail "learning.query (got: $LQ)"

FQ=$(curl -s -X POST "$API/v1/intent/fact.query" "${auth[@]}" -d "{\"project_id\":\"$PROJ\",\"query\":\"latency\"}")
echo "$FQ" | grep -q "request latency dropped" && pass "fact.query 'latency' returns the match" || fail "fact.query (got: $FQ)"

# An unrelated query does NOT return the recorded items.
LN=$(curl -s -X POST "$API/v1/intent/learning.query" "${auth[@]}" -d "{\"project_id\":\"$PROJ\",\"query\":\"kubernetes\"}")
echo "$LN" | grep -q "vllm gpu deployment" && fail "irrelevant query returned the learning" || pass "irrelevant query excludes the learning"

# Cleanup.
docker compose exec -T db psql -U postgres -d memos -q >/dev/null 2>&1 <<SQL
delete from facts where bd_id='$BD';
delete from learnings where bd_id='$BD';
delete from workflow_runs where bd_id='$BD';
delete from agents where display_name='phase4-agent';
delete from enrollment_codes where code='$CODE';
SQL

echo "=== Phase 4 summary ==="
if [ "$fails" -eq 0 ]; then echo "ALL CHECKS PASS"; exit 0; else echo "$fails CHECK(S) FAILED"; exit 1; fi

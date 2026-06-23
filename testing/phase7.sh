#!/usr/bin/env bash
# Phase 7 gateway-side test — the dashboard's read surface + live SSE stream, over HTTP.
#   enroll -> workflow -> record a fact -> activity.recent returns it -> agent.me returns scopes
#   -> open the SSE stream, post another fact, assert the event frame arrives live.
# (The browser/dashboard + Playwright path is verified separately.)
#
# Run from the repo root in Git Bash:  bash testing/phase7.sh
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
API="http://127.0.0.1:8787"

fails=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; fails=$((fails + 1)); }

echo "=== MemOS Phase 7 ==="

PROJ="project.demo"
CODE="enr_code_phase7_$(date +%s)_$$"

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

ENR=$(curl -s -X POST "$API/v1/intent/agent.enroll" -H 'content-type: application/json' \
  -d "{\"code\":\"$CODE\",\"display_name\":\"phase7-agent\"}")
TOK=$(echo "$ENR" | sed -n 's/.*"raw":"\(syn_[^"]*\)".*/\1/p')
echo "$TOK" | grep -q '^syn_' && pass "enrolled" || fail "enroll"
auth=(-H "authorization: Bearer $TOK" -H 'content-type: application/json')

# agent.me returns the agent's scopes.
curl -s -X POST "$API/v1/intent/agent.me" "${auth[@]}" -d '{}' | grep -q "\"$PROJ\"" \
  && pass "agent.me returns scopes" || fail "agent.me"

BD=$(curl -s -X POST "$API/v1/intent/workflow.create" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"workflow_class\":\"investigation\",\"title\":\"phase7 run\"}" \
  | sed -n 's/.*"bd_id":"\(memos-[^"]*\)".*/\1/p')
echo "$BD" | grep -qE '^memos-' && pass "workflow.create -> $BD" || fail "workflow.create"

curl -s -X POST "$API/v1/intent/fact.record" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"bd_id\":\"$BD\",\"facts\":[{\"claim\":\"phase7 seed fact\",\"confidence\":\"low\"}]}" >/dev/null

curl -s -X POST "$API/v1/intent/activity.recent" "${auth[@]}" -d "{\"project_id\":\"$PROJ\"}" \
  | grep -q "phase7 seed fact" && pass "activity.recent returns the fact" || fail "activity.recent"

# Live SSE: open the stream, post a fact with a unique marker, assert the event frame arrives.
MARKER="sse-marker-$$-$(date +%s)"
( curl -sN --max-time 8 "${auth[@]}" "$API/v1/stream/activity?project_id=$PROJ" >/tmp/memos-sse.log 2>&1 ) &
SSE_PID=$!
sleep 2
curl -s -X POST "$API/v1/intent/fact.record" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"bd_id\":\"$BD\",\"facts\":[{\"claim\":\"$MARKER\",\"confidence\":\"low\"}]}" >/dev/null
wait $SSE_PID 2>/dev/null
grep -q "$MARKER" /tmp/memos-sse.log && pass "SSE stream pushed the new fact live" || fail "SSE (got: $(tail -3 /tmp/memos-sse.log))"

# Out-of-scope project on the stream -> 403.
SC=$(curl -s -o /dev/null -w '%{http_code}' -N --max-time 4 "${auth[@]}" "$API/v1/stream/activity?project_id=project.other")
[ "$SC" = "403" ] && pass "SSE rejects out-of-scope project (403)" || fail "SSE scope (got HTTP $SC)"

# Cleanup.
docker compose exec -T db psql -U postgres -d memos -q >/dev/null 2>&1 <<SQL
delete from facts where bd_id='$BD';
delete from workflow_runs where bd_id='$BD';
delete from agents where display_name='phase7-agent';
delete from enrollment_codes where code='$CODE';
SQL

echo "=== Phase 7 summary ==="
if [ "$fails" -eq 0 ]; then echo "ALL CHECKS PASS"; exit 0; else echo "$fails CHECK(S) FAILED"; exit 1; fi

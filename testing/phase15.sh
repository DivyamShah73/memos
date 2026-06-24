#!/usr/bin/env bash
# Phase 15 — admin READ side over HTTP (ADR-013): the data the dashboard admin page needs.
# signup → agent.me carries role → member.list (CEO) → invite → member.list shows the new user →
# mint code → agent enrolls → agent.list shows it → role-gate (member agent 403 on the lists) →
# revoke → offboard. Self-starts the gateway.
#
# Run from the repo root in Git Bash:  bash testing/phase15.sh
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT" || exit 1
API="http://127.0.0.1:8787"
fails=0; pass(){ echo "PASS: $1"; }; fail(){ echo "FAIL: $1"; fails=$((fails+1)); }
jget(){ echo "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p"; }

echo "=== MemOS Phase 15 (admin read side) ==="

STARTED=0
if ! curl -sf "$API/health" >/dev/null 2>&1; then
  pnpm --filter @memos/api exec tsx src/server.ts >/tmp/memos-gw15.log 2>&1 & STARTED=1
  for _ in $(seq 1 30); do curl -sf "$API/health" >/dev/null 2>&1 && break; sleep 1; done
fi
ORG_FOR_CLEANUP=""
cleanup(){
  if [ -n "$ORG_FOR_CLEANUP" ]; then
    docker compose exec -T db psql -U postgres -d memos -q >/dev/null 2>&1 <<SQL
delete from audit_log where org_id='$ORG_FOR_CLEANUP';
delete from memberships where org_id='$ORG_FOR_CLEANUP';
delete from users where org_id='$ORG_FOR_CLEANUP';
delete from enrollment_codes where org_id='$ORG_FOR_CLEANUP';
delete from agents where org_id='$ORG_FOR_CLEANUP';
delete from projects where org_id='$ORG_FOR_CLEANUP';
delete from teams where org_id='$ORG_FOR_CLEANUP';
delete from orgs where id='$ORG_FOR_CLEANUP';
SQL
  fi
  if [ "$STARTED" -eq 1 ]; then pid=$(netstat -ano 2>/dev/null | grep -E ':8787[^0-9]' | grep -i LISTENING | awk '{print $NF}' | head -1); [ -n "$pid" ] && taskkill //F //PID "$pid" >/dev/null 2>&1; fi
}
trap cleanup EXIT
curl -sf "$API/health" >/dev/null 2>&1 && pass "gateway up" || fail "gateway up"

post(){ curl -s -X POST "$API/v1/intent/$1" ${2:+-H "authorization: Bearer $2"} -H 'content-type: application/json' -d "$3"; }
status(){ curl -s -o /dev/null -w "%{http_code}" -X POST "$API/v1/intent/$1" ${2:+-H "authorization: Bearer $2"} -H 'content-type: application/json' -d "$3"; }

# 1. signup → CEO session + first project
SU=$(post org.signup "" '{"org_name":"Phase15 Co","email":"founder15@x.test","password":"founder-strong-pw-1"}')
ORG=$(jget "$SU" org_id); ORG_FOR_CLEANUP="$ORG"; CEO=$(jget "$SU" raw)
PROJ=$(echo "$SU" | sed -n 's/.*"projects":\["\([^"]*\)".*/\1/p')
{ [ -n "$ORG" ] && [ -n "$CEO" ] && [ -n "$PROJ" ]; } && pass "org.signup → org=$ORG" || fail "org.signup ($SU)"

# 2. agent.me now carries role
echo "$(post agent.me "$CEO" '{}')" | grep -q '"role":"ceo"' && pass "agent.me returns role=ceo" || fail "agent.me missing role"

# 3. member.list (CEO) shows the founder
ML=$(post member.list "$CEO" '{}')
echo "$ML" | grep -q 'founder15@x.test' && pass "member.list shows the founder" || fail "member.list ($ML)"

# 4. invite → member.list shows the new user
post user.invite "$CEO" "{\"email\":\"m15@x.test\",\"password\":\"invitee-strong-pw-2\",\"display_name\":\"M15\",\"role\":\"member\",\"scope_kind\":\"project\",\"scope_id\":\"$PROJ\"}" >/dev/null
echo "$(post member.list "$CEO" '{}')" | grep -q 'm15@x.test' && pass "member.list shows the invited user" || fail "invited user missing from member.list"

# 5. mint code → agent enrolls → agent.list shows it
CODE=$(jget "$(post enrollment.create "$CEO" "{\"project_id\":\"$PROJ\",\"role\":\"member\"}")" code)
ENR=$(post agent.enroll "" "{\"code\":\"$CODE\",\"display_name\":\"p15-agent\"}")
ATOK=$(jget "$ENR" raw); AID=$(jget "$ENR" agent_id)
[ -n "$AID" ] && pass "agent enrolled ($AID)" || fail "agent.enroll"
echo "$(post agent.list "$CEO" '{}')" | grep -q "$AID" && pass "agent.list shows the new agent" || fail "agent.list missing the agent"

# 6. role gate — a member agent cannot enumerate the org
[ "$(status member.list "$ATOK" '{}')" = "403" ] && pass "member agent CANNOT member.list (403)" || fail "member.list not role-gated"
[ "$(status agent.list "$ATOK" '{}')" = "403" ] && pass "member agent CANNOT agent.list (403)" || fail "agent.list not role-gated"

# 7. revoke the agent → agent.me as that token is rejected
post agent.revoke "$CEO" "{\"agent_id\":\"$AID\"}" >/dev/null
[ "$(status agent.me "$ATOK" '{}')" = "401" ] && pass "revoked agent token rejected (401)" || fail "agent.revoke didn't take effect"

echo "=== Phase 15 summary ==="
if [ "$fails" -eq 0 ]; then echo "ALL CHECKS PASS"; exit 0; else echo "$fails CHECK(S) FAILED"; exit 1; fi

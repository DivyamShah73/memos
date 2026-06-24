#!/usr/bin/env bash
# Phase 14 — self-serve admin & lifecycle (ADR-012). The full zero-operator loop over HTTP:
# org.signup (public) → CEO mints an agent code → agent enrolls → CEO invites a user (who can log in)
# → offboard disables that login → agent.revoke kills the agent token. Self-starts the gateway.
#
# Run from the repo root in Git Bash:  bash testing/phase14.sh
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT" || exit 1
API="http://127.0.0.1:8787"
fails=0; pass(){ echo "PASS: $1"; }; fail(){ echo "FAIL: $1"; fails=$((fails+1)); }
jget(){ echo "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p"; }   # first string field

echo "=== MemOS Phase 14 (self-serve admin & lifecycle) ==="

STARTED=0
if ! curl -sf "$API/health" >/dev/null 2>&1; then
  pnpm --filter @memos/api exec tsx src/server.ts >/tmp/memos-gw14.log 2>&1 & STARTED=1
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
SU=$(post org.signup "" '{"org_name":"Phase14 Co","email":"founder14@x.test","password":"founder-strong-pw-1"}')
ORG=$(jget "$SU" org_id); ORG_FOR_CLEANUP="$ORG"; CEO=$(jget "$SU" raw)
PROJ=$(echo "$SU" | sed -n 's/.*"projects":\["\([^"]*\)".*/\1/p')
{ [ -n "$ORG" ] && [ -n "$CEO" ] && [ -n "$PROJ" ]; } && pass "org.signup → org=$ORG project=$PROJ" || fail "org.signup ($SU)"

# 2. CEO mints an agent code → agent enrolls → works
CODE=$(jget "$(post enrollment.create "$CEO" "{\"project_id\":\"$PROJ\",\"role\":\"member\"}")" code)
[ -n "$CODE" ] && pass "enrollment.create → code" || fail "enrollment.create"
ENR=$(post agent.enroll "" "{\"code\":\"$CODE\",\"display_name\":\"p14-agent\"}")
ATOK=$(jget "$ENR" raw); AID=$(jget "$ENR" agent_id)
[ -n "$ATOK" ] && pass "agent enrolled with minted code" || fail "agent.enroll"
[ "$(status learning.query "$ATOK" "{\"project_id\":\"$PROJ\",\"query\":\"x\"}")" != "403" ] && pass "enrolled agent can work" || fail "agent blocked"
[ "$(status enrollment.create "$ATOK" "{\"project_id\":\"$PROJ\"}")" = "403" ] && pass "member agent CANNOT administer (403)" || fail "member admin not blocked"

# 3. invite a user → can log in → offboard → cannot log in
IUSERID=$(jget "$(post user.invite "$CEO" "{\"email\":\"invitee14@x.test\",\"password\":\"invitee-strong-pw-2\",\"display_name\":\"Invitee\",\"role\":\"member\",\"scope_kind\":\"project\",\"scope_id\":\"$PROJ\"}")" user_id)
[ -n "$IUSERID" ] && pass "user.invite → user_id" || fail "user.invite"
echo "$(post user.login "" '{"email":"invitee14@x.test","password":"invitee-strong-pw-2"}')" | grep -q '"ok":true' && pass "invited user can log in" || fail "invited login"
post member.offboard "$CEO" "{\"user_id\":\"$IUSERID\"}" >/dev/null
[ "$(status user.login "" '{"email":"invitee14@x.test","password":"invitee-strong-pw-2"}')" = "401" ] && pass "offboarded user CANNOT log in" || fail "offboard didn't revoke login"

# 4. revoke the agent → its token stops working
post agent.revoke "$CEO" "{\"agent_id\":\"$AID\"}" >/dev/null
[ "$(status agent.me "$ATOK" '{}')" = "401" ] && pass "revoked agent token rejected (401)" || fail "agent.revoke didn't take effect"

echo "=== Phase 14 summary ==="
if [ "$fails" -eq 0 ]; then echo "ALL CHECKS PASS"; exit 0; else echo "$fails CHECK(S) FAILED"; exit 1; fi

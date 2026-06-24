#!/usr/bin/env bash
# Phase 13 — per-user login & user-principal scoping (ADR-011). Proves over HTTP that user.login
# returns a session token, the gateway authenticates it as a user principal with the right role +
# project scope, and the authz guard applies (member can't steer, CEO read-only). Self-starts the
# gateway. The seeded users (Acme CEO/manager/member) come from `pnpm db:seed`.
#
# Run from the repo root in Git Bash:  bash testing/phase13.sh
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT" || exit 1
API="http://127.0.0.1:8787"
fails=0; pass(){ echo "PASS: $1"; }; fail(){ echo "FAIL: $1"; fails=$((fails+1)); }

echo "=== MemOS Phase 13 (per-user login & scoping) ==="
pnpm db:seed >/dev/null 2>&1 && pass "seed (CEO/manager/member users)" || fail "seed"

STARTED=0
if ! curl -sf "$API/health" >/dev/null 2>&1; then
  pnpm --filter @memos/api exec tsx src/server.ts >/tmp/memos-gw13.log 2>&1 & STARTED=1
  for _ in $(seq 1 30); do curl -sf "$API/health" >/dev/null 2>&1 && break; sleep 1; done
fi
cleanup_gw(){ if [ "$STARTED" -eq 1 ]; then pid=$(netstat -ano 2>/dev/null | grep -E ':8787[^0-9]' | grep -i LISTENING | awk '{print $NF}' | head -1); [ -n "$pid" ] && taskkill //F //PID "$pid" >/dev/null 2>&1; fi; }
trap cleanup_gw EXIT
curl -sf "$API/health" >/dev/null 2>&1 && pass "gateway up" || fail "gateway up"

login(){ curl -s -X POST "$API/v1/intent/user.login" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}"; }
tok(){ echo "$1" | sed -n 's/.*"raw":"\([^"]*\)".*/\1/p'; }
st(){ curl -s -o /dev/null -w "%{http_code}" -X POST "$API/v1/intent/$1" -H "authorization: Bearer $2" -H 'content-type: application/json' -d "$3"; }

CEO_J=$(login "ceo@acme.test" "demo-ceo-pass")
echo "$CEO_J" | grep -q '"role":"ceo"' && pass "CEO login → role ceo" || fail "CEO login ($(echo "$CEO_J" | head -c 120))"
echo "$CEO_J" | grep -q 'project.demo' && pass "CEO scope includes project.demo" || fail "CEO scope"
CEO_T=$(tok "$CEO_J")

MEM_J=$(login "member@acme.test" "demo-member-pass")
echo "$MEM_J" | grep -q '"role":"member"' && pass "member login → role member" || fail "member login"
MEM_T=$(tok "$MEM_J")
MGR_T=$(tok "$(login "manager@acme.test" "demo-manager-pass")")

BRIEF='{"project_id":"project.demo","title":"t","body":"b","target_kind":"project","target_id":"project.demo"}'
FACT='{"project_id":"project.demo","bd_id":"memos-nope","facts":[{"claim":"x","confidence":"low"}]}'

[ "$(st brief.create "$MEM_T" "$BRIEF")" = "403" ] && pass "member CANNOT steer (403)" || fail "member steering not blocked"
[ "$(st brief.create "$MGR_T" "$BRIEF")" != "403" ] && pass "manager CAN steer (not 403)" || fail "manager steering blocked"
[ "$(st fact.record "$CEO_T" "$FACT")" = "403" ] && pass "CEO read-only (fact.record 403)" || fail "CEO write not blocked"
[ "$(st objective.query "$CEO_T" '{"project_id":"project.demo"}')" != "403" ] && pass "CEO can read (not 403)" || fail "CEO read blocked"
[ "$(login "ceo@acme.test" "wrong")" = "" ] || { echo "$(login "ceo@acme.test" "wrong")" | grep -q '"ok":false' && pass "wrong password rejected" || fail "wrong password not rejected"; }

echo "=== Phase 13 summary ==="
if [ "$fails" -eq 0 ]; then echo "ALL CHECKS PASS"; exit 0; else echo "$fails CHECK(S) FAILED"; exit 1; fi

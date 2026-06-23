#!/usr/bin/env bash
# Phase 12 — roles & authorization (ADR-010). Proves the dispatch authz guard over HTTP: a member
# cannot steer (403), a manager can, and the CEO is read-only (writes 403, reads allowed). Self-starts
# the gateway like the other phase scripts.
#
# Run from the repo root in Git Bash:  bash testing/phase12.sh
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT" || exit 1
API="http://127.0.0.1:8787"
fails=0; pass(){ echo "PASS: $1"; }; fail(){ echo "FAIL: $1"; fails=$((fails+1)); }

echo "=== MemOS Phase 12 (roles & authorization) ==="

SFX="$(date +%s)_$$"
CODE_M="enr_p12_member_$SFX"; CODE_G="enr_p12_manager_$SFX"; CODE_C="enr_p12_ceo_$SFX"
docker compose exec -T db psql -U postgres -d memos -q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
insert into orgs (id,name) values ('org','Demo Org') on conflict (id) do nothing;
insert into teams (id,org_id,name) values ('team.demo','org','Demo Team') on conflict (id) do nothing;
insert into projects (id,team_id,org_id,name,okrs_required) values ('project.demo','team.demo','org','Demo',false) on conflict (id) do nothing;
insert into enrollment_codes (code,team_id,org_id,role,scopes) values ('$CODE_M','team.demo','org','member','["project.demo"]'::jsonb);
insert into enrollment_codes (code,team_id,org_id,role,scopes) values ('$CODE_G','team.demo','org','manager','["project.demo"]'::jsonb);
insert into enrollment_codes (code,team_id,org_id,role,scopes) values ('$CODE_C','team.demo','org','ceo','["project.demo"]'::jsonb);
SQL
[ $? -eq 0 ] && pass "seeded 3 role codes" || fail "seed"

STARTED=0
if ! curl -sf "$API/health" >/dev/null 2>&1; then
  pnpm --filter @memos/api exec tsx src/server.ts >/tmp/memos-gw12.log 2>&1 & STARTED=1
  for _ in $(seq 1 30); do curl -sf "$API/health" >/dev/null 2>&1 && break; sleep 1; done
fi
cleanup_gw(){ if [ "$STARTED" -eq 1 ]; then pid=$(netstat -ano 2>/dev/null | grep -E ':8787[^0-9]' | grep -i LISTENING | awk '{print $NF}' | head -1); [ -n "$pid" ] && taskkill //F //PID "$pid" >/dev/null 2>&1; fi; }
trap cleanup_gw EXIT
curl -sf "$API/health" >/dev/null 2>&1 && pass "gateway up" || fail "gateway up"

enroll(){ curl -s -X POST "$API/v1/intent/agent.enroll" -H 'content-type: application/json' -d "{\"code\":\"$1\",\"display_name\":\"$2\"}" | sed -n 's/.*"raw":"\([^"]*\)".*/\1/p'; }
TM=$(enroll "$CODE_M" "p12-member"); TG=$(enroll "$CODE_G" "p12-manager"); TC=$(enroll "$CODE_C" "p12-ceo")
[ -n "$TM" ] && [ -n "$TG" ] && [ -n "$TC" ] && pass "enrolled member/manager/ceo" || fail "enroll (m=$TM g=$TG c=$TC)"

# status helper
st(){ curl -s -o /dev/null -w "%{http_code}" -X POST "$API/v1/intent/$1" -H "authorization: Bearer $2" -H 'content-type: application/json' -d "$3"; }
BRIEF='{"project_id":"project.demo","title":"t","body":"b","target_kind":"project","target_id":"project.demo"}'
FACT='{"project_id":"project.demo","bd_id":"memos-nope","facts":[{"claim":"x","confidence":"low"}]}'
QUERY='{"project_id":"project.demo","query":"anything"}'

[ "$(st brief.create "$TM" "$BRIEF")" = "403" ] && pass "member CANNOT steer (brief.create 403)" || fail "member steering not blocked"
[ "$(st brief.create "$TG" "$BRIEF")" != "403" ] && pass "manager CAN steer (brief.create not 403)" || fail "manager steering blocked"
[ "$(st fact.record "$TC" "$FACT")" = "403" ] && pass "ceo is read-only (fact.record 403)" || fail "ceo write not blocked"
[ "$(st learning.query "$TC" "$QUERY")" != "403" ] && pass "ceo CAN read (learning.query not 403)" || fail "ceo read blocked"

# cleanup test rows
docker compose exec -T db psql -U postgres -d memos -q >/dev/null 2>&1 <<SQL
delete from agents where display_name in ('p12-member','p12-manager','p12-ceo');
delete from enrollment_codes where code in ('$CODE_M','$CODE_G','$CODE_C');
SQL

echo "=== Phase 12 summary ==="
if [ "$fails" -eq 0 ]; then echo "ALL CHECKS PASS"; exit 0; else echo "$fails CHECK(S) FAILED"; exit 1; fi

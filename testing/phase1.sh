#!/usr/bin/env bash
# Phase 1 manual test — gateway core + auth + enrollment, over real HTTP.
# Seeds a fresh enrollment code, ensures the gateway is up (starts it if needed),
# and checks: enroll -> syn_ token, reuse -> ok:false, no-token authed -> 401,
# malformed -> 400, and that the DB stores a hash (never the raw token).
#
# Run from the repo root in Git Bash:  bash testing/phase1.sh
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
API="http://127.0.0.1:8787"

fails=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; fails=$((fails + 1)); }

echo "=== MemOS Phase 1 ==="

# 1. Seed a fresh, unique enrollment code (re-runnable; single-use codes can't be reused).
CODE="enr_code_phase1_$(date +%s)_$$"
docker compose exec -T db psql -U postgres -d memos -v ON_ERROR_STOP=1 -q >/dev/null 2>&1 <<SQL
insert into orgs (id, name) values ('org','Demo Org') on conflict (id) do nothing;
insert into teams (id, org_id, name) values ('team.demo','org','Demo Team') on conflict (id) do nothing;
insert into projects (id, team_id, name) values ('project.demo','team.demo','Demo Project') on conflict (id) do nothing;
insert into enrollment_codes (code, team_id, scopes) values ('$CODE','team.demo','["project.demo"]'::jsonb);
SQL
if [ $? -eq 0 ]; then pass "seeded enrollment code"; else fail "seed enrollment code"; fi

# 2. Ensure the gateway is running. If we start it, we own cleanup.
STARTED=0
if curl -sf "$API/health" >/dev/null 2>&1; then
  pass "gateway already running"
else
  echo "starting gateway (tsx, no watch)..."
  pnpm --filter @memos/api exec tsx src/server.ts >/tmp/memos-gw.log 2>&1 &
  STARTED=1
  for _ in $(seq 1 30); do
    curl -sf "$API/health" >/dev/null 2>&1 && break
    sleep 1
  done
  if curl -sf "$API/health" >/dev/null 2>&1; then
    pass "gateway started"
  else
    fail "gateway started (see /tmp/memos-gw.log)"
  fi
fi

cleanup() {
  if [ "$STARTED" -eq 1 ]; then
    # On Git Bash, $! is the MSYS pid, not the native node pid holding the port. Find the
    # actual listener via netstat and kill its process tree.
    local pid
    pid=$(netstat -ano 2>/dev/null | grep -E ':8787[^0-9]' | grep -i LISTENING | awk '{print $NF}' | head -1)
    [ -n "$pid" ] && taskkill //F //T //PID "$pid" >/dev/null 2>&1
  fi
}
trap cleanup EXIT

# 3. Enroll with the seeded code -> syn_ token (shown once).
ENROLL=$(curl -s -X POST "$API/v1/intent/agent.enroll" -H 'content-type: application/json' \
  -d "{\"code\":\"$CODE\",\"display_name\":\"phase1-tester\"}")
TOK=$(echo "$ENROLL" | sed -n 's/.*"raw":"\(syn_[^"]*\)".*/\1/p')
if echo "$TOK" | grep -q '^syn_'; then
  pass "enroll returned a syn_ token (${TOK:0:14}...)"
else
  fail "enroll token (got: $ENROLL)"
fi

# 4. Reuse the same code -> ok:false (single-use).
REUSE=$(curl -s -X POST "$API/v1/intent/agent.enroll" -H 'content-type: application/json' \
  -d "{\"code\":\"$CODE\",\"display_name\":\"phase1-dup\"}")
if echo "$REUSE" | grep -q '"ok":false'; then
  pass "reused code rejected (ok:false)"
else
  fail "reuse rejection (got: $REUSE)"
fi

# 5. No-token call to an authed intent -> 401.
S401=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/v1/intent/workflow.create" \
  -H 'content-type: application/json' -d '{}')
if [ "$S401" = "401" ]; then pass "no-token authed call -> 401"; else fail "no-token 401 (got: $S401)"; fi

# 6. Malformed body (missing required fields) -> 400.
S400=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/v1/intent/agent.enroll" \
  -H 'content-type: application/json' -d '{}')
if [ "$S400" = "400" ]; then pass "malformed body -> 400"; else fail "malformed 400 (got: $S400)"; fi

# 7. DB stores a hash, never the raw token.
HASH=$(docker compose exec -T db psql -U postgres -d memos -t -A \
  -c "select api_token_hash from agents where display_name='phase1-tester' order by created_at desc limit 1;" 2>/dev/null | tr -d '[:space:]')
if echo "$HASH" | grep -qE '^[0-9a-f]{64}$'; then
  pass "DB stores a 64-char hex hash (not the raw token)"
else
  fail "token hash shape (got: $HASH)"
fi
if echo "$HASH" | grep -q '^syn_'; then fail "raw token leaked into the DB"; fi

# Clean up the rows this run created (leave org/team/project demo fixtures).
docker compose exec -T db psql -U postgres -d memos -q \
  -c "delete from agents where display_name in ('phase1-tester','phase1-dup'); delete from enrollment_codes where code='$CODE';" >/dev/null 2>&1

echo "=== Phase 1 summary ==="
if [ "$fails" -eq 0 ]; then
  echo "ALL CHECKS PASS"
  exit 0
else
  echo "$fails CHECK(S) FAILED"
  exit 1
fi

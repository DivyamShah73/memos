#!/usr/bin/env bash
# Phase 11 — multi-org foundation. Proves over the wire that (a) the seed provisions multiple orgs
# each with a CEO user, (b) the org_id backfill held (no nulls), and (c) people (users) are
# ORG-ISOLATED at the DB under the least-privileged memos_app role + the memos.org_id GUC — org A's
# scope cannot see org B's CEO, and vice-versa. The agent loop itself is re-proven by smoke_all 0-10.
#
# Run from the repo root in Git Bash:  bash testing/phase11.sh
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT" || exit 1
APP_URL="postgresql://memos_app:memos_app@localhost:5432/memos"
OWNER() { docker compose exec -T db psql -U postgres -d memos -tAc "$1" 2>/dev/null | tr -d '[:space:]'; }
# Two -c in one psql session: set the org GUC (session-level), then query under it as memos_app.
APP_UNDER() { docker compose exec -T db psql "$APP_URL" -tA -c "select set_config('memos.org_id','$1',false)" -c "$2" 2>/dev/null | tail -1 | tr -d '[:space:]'; }

fails=0; pass(){ echo "PASS: $1"; }; fail(){ echo "FAIL: $1"; fails=$((fails+1)); }

echo "=== MemOS Phase 11 (multi-org foundation) ==="

# 0. seed (idempotent) — provisions org (Acme) + org2 (Globex), each with a CEO user.
pnpm db:seed >/dev/null 2>&1 && pass "seed provisions 2 orgs" || fail "seed"

# 1. a CEO user per org
ACME=$(OWNER "select count(*) from users where org_id='org';")
GLOBEX=$(OWNER "select count(*) from users where org_id='org2';")
{ [ "${ACME:-0}" -ge 1 ] && [ "${GLOBEX:-0}" -ge 1 ]; } \
  && pass "a CEO user exists per org (acme=$ACME, globex=$GLOBEX)" || fail "CEO users (acme=$ACME, globex=$GLOBEX)"

# 2. org_id backfill held — no nulls anywhere
NULLS=$(OWNER "select (select count(*) from projects where org_id is null)+(select count(*) from agents where org_id is null)+(select count(*) from enrollment_codes where org_id is null);")
[ "${NULLS:-1}" = "0" ] && pass "every project/agent/code carries org_id" || fail "org_id nulls present: $NULLS"

# 3. cross-org isolation under memos_app + the org GUC (the headline)
HID=$(APP_UNDER "org" "select count(*) from users where lower(email)='ceo@globex.test'")
[ "${HID:-x}" = "0" ] && pass "org 'org' scope CANNOT see org2's CEO (RLS deny)" || fail "cross-org leak (saw $HID)"
SELF=$(APP_UNDER "org2" "select count(*) from users where lower(email)='ceo@globex.test'")
[ "${SELF:-x}" = "1" ] && pass "org2 scope CAN see its own CEO" || fail "org2 self-visibility ($SELF)"
NONE=$(APP_UNDER "" "select count(*) from users")
[ "${NONE:-x}" = "0" ] && pass "unset/empty org GUC denies all (default-deny)" || fail "empty GUC not deny-all ($NONE)"

echo "=== Phase 11 summary ==="
if [ "$fails" -eq 0 ]; then echo "ALL CHECKS PASS"; exit 0; else echo "$fails CHECK(S) FAILED"; exit 1; fi

#!/usr/bin/env bash
# Phase 0 manual test — repo + infra skeleton.
# Brings up the stack, applies migrations, and asserts every table from
# docs/DATA_MODEL.md exists. Prints PASS/FAIL per check; exits non-zero on any FAIL.
#
# Run from the repo root in Git Bash:  bash testing/phase0.sh
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

fails=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; fails=$((fails + 1)); }

echo "=== MemOS Phase 0 ==="

# 1. Bring up infra.
echo "--- docker compose up -d ---"
if docker compose up -d; then
  pass "docker compose up"
else
  fail "docker compose up"
  echo "Cannot continue without infra. Is Docker running?"
  exit 1
fi

# 2. Wait for Postgres to be ready (healthcheck-backed, plus a bounded poll).
echo "--- waiting for postgres ---"
ready=0
for i in $(seq 1 30); do
  if docker compose exec -T db pg_isready -U postgres -d memos >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
if [ "$ready" -eq 1 ]; then pass "postgres ready"; else fail "postgres ready"; fi

# 3. Apply migrations.
echo "--- pnpm db:migrate ---"
if pnpm db:migrate; then
  pass "pnpm db:migrate"
else
  fail "pnpm db:migrate"
fi

# 4. Assert every expected table exists.
echo "--- table check ---"
TABLES="orgs teams projects agents enrollment_codes objectives milestones \
workflow_runs checkins facts learnings artifacts briefs brief_acks questions \
feedback choices"

dump="$(docker compose exec -T db psql -U postgres -d memos -t -A \
  -c "select tablename from pg_tables where schemaname='public';" 2>/dev/null)"

for tbl in $TABLES; do
  if echo "$dump" | grep -qx "$tbl"; then
    pass "table $tbl"
  else
    fail "table $tbl (missing)"
  fi
done

# 5. Spot-check the load-bearing invariants of Phase 0: vector column + FORCE RLS.
echo "--- schema spot-checks ---"
vec="$(docker compose exec -T db psql -U postgres -d memos -t -A \
  -c "select format_type(atttypid, atttypmod) from pg_attribute \
      where attrelid='facts'::regclass and attname='embedding';" 2>/dev/null)"
if echo "$vec" | grep -qi "vector(1536)"; then
  pass "facts.embedding is vector(1536)"
else
  fail "facts.embedding is vector(1536) (got: ${vec:-none})"
fi

forced="$(docker compose exec -T db psql -U postgres -d memos -t -A \
  -c "select relforcerowsecurity from pg_class where relname='facts';" 2>/dev/null)"
if echo "$forced" | grep -qx "t"; then
  pass "facts has FORCE row level security"
else
  fail "facts FORCE row level security (got: ${forced:-none})"
fi

npolicies="$(docker compose exec -T db psql -U postgres -d memos -t -A \
  -c "select count(*) from pg_policies where tablename='facts';" 2>/dev/null)"
if [ "${npolicies:-0}" -ge 4 ]; then
  pass "facts has >=4 RLS policies ($npolicies)"
else
  fail "facts RLS policy count (got: ${npolicies:-0}, want >=4)"
fi

echo "=== Phase 0 summary ==="
if [ "$fails" -eq 0 ]; then
  echo "ALL CHECKS PASS"
  echo "(Manual: confirm the MinIO console is reachable at http://localhost:9001)"
  exit 0
else
  echo "$fails CHECK(S) FAILED"
  exit 1
fi

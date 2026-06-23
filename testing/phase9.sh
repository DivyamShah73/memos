#!/usr/bin/env bash
# Phase 9 — the full agent loop driven by the @memos/agent SDK over HTTP, plus the three core
# invariant proofs (evidence gate, tenant isolation, UTF-8 round-trip). Self-starts the gateway
# and runs sdk/memos-agent/e2e/full-loop.ts.
#
# Run from the repo root in Git Bash:  bash testing/phase9.sh
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
API="http://127.0.0.1:8787"

fails=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; fails=$((fails + 1)); }

echo "=== MemOS Phase 9 ==="

CODE_A="enr_code_p9a_$(date +%s)_$$"
CODE_B="enr_code_p9b_$(date +%s)_$$"

docker compose exec -T db psql -U postgres -d memos -q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
insert into orgs (id, name) values ('org','Demo Org') on conflict (id) do nothing;
insert into teams (id, org_id, name) values ('team.demo','org','Demo Team') on conflict (id) do nothing;
insert into projects (id, team_id, name, okrs_required) values ('project.demo','team.demo','Demo Project',false) on conflict (id) do nothing;
insert into projects (id, team_id, name, okrs_required) values ('project.other','team.demo','Other Project',false) on conflict (id) do nothing;
insert into enrollment_codes (code, team_id, scopes) values ('$CODE_A','team.demo','["project.demo"]'::jsonb);
insert into enrollment_codes (code, team_id, scopes) values ('$CODE_B','team.demo','["project.other"]'::jsonb);
SQL
[ $? -eq 0 ] && pass "seeded 2 projects + codes" || fail "seed"

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

# Run the SDK-driven e2e (prints its own PASS/FAIL lines; exits non-zero on any failure).
MEMOS_API_URL="$API" CODE_A="$CODE_A" CODE_B="$CODE_B" \
  pnpm --filter @memos/agent exec tsx e2e/full-loop.ts
SDK_EXIT=$?
[ "$SDK_EXIT" -eq 0 ] && pass "SDK full e2e loop + invariant proofs" || fail "SDK e2e (exit $SDK_EXIT)"

# Cleanup.
docker compose exec -T db psql -U postgres -d memos -q >/dev/null 2>&1 <<SQL
delete from facts where project_id='project.other';
delete from learnings where project_id='project.other';
delete from checkins where project_id='project.other';
delete from artifacts where project_id='project.other';
delete from milestones where project_id='project.other';
delete from workflow_runs where project_id='project.other';
delete from objectives where project_id='project.other';
delete from facts where bd_id in (select bd_id from workflow_runs where agent_id like 'agent.e2e-agent-a-%');
delete from learnings where bd_id in (select bd_id from workflow_runs where agent_id like 'agent.e2e-agent-a-%');
delete from checkins where bd_id in (select bd_id from workflow_runs where agent_id like 'agent.e2e-agent-a-%');
delete from artifacts where bd_id in (select bd_id from workflow_runs where agent_id like 'agent.e2e-agent-a-%');
delete from milestones where objective_id in (select id from objectives where agent_id like 'agent.e2e-agent-a-%');
update workflow_runs set target_objective_id=null where agent_id like 'agent.e2e-agent-a-%';
delete from objectives where agent_id like 'agent.e2e-agent-a-%';
delete from workflow_runs where agent_id like 'agent.e2e-agent-a-%';
delete from briefs where author_id like 'agent.e2e-agent-%' or target_id like 'agent.e2e-agent-%';
delete from projects where id='project.other';
delete from agents where display_name in ('e2e-agent-a','e2e-agent-b');
delete from enrollment_codes where code in ('$CODE_A','$CODE_B');
SQL

echo "=== Phase 9 summary ==="
if [ "$fails" -eq 0 ]; then echo "ALL CHECKS PASS"; exit 0; else echo "$fails CHECK(S) FAILED"; exit 1; fi

#!/usr/bin/env bash
# Phase 2 manual test — workflow + checkin (the provenance spine), over real HTTP.
# Seeds an okrs_required project + active objective + a fresh code, enrolls, opens a
# workflow bound to the objective, fires start + complete checkins, and asserts the run
# closed. Also checks the okrs binding rule (no objective -> rejected).
#
# Run from the repo root in Git Bash:  bash testing/phase2.sh
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
API="http://127.0.0.1:8787"

fails=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; fails=$((fails + 1)); }

echo "=== MemOS Phase 2 ==="

PROJ="project.demo-okr"
CODE="enr_code_phase2_$(date +%s)_$$"

# 1. Seed org/team/okrs-required project + a fresh active objective + a fresh code.
OBJ=$(docker compose exec -T db psql -U postgres -d memos -q -t -A -v ON_ERROR_STOP=1 <<SQL | tr -d '[:space:]'
insert into orgs (id, name) values ('org','Demo Org') on conflict (id) do nothing;
insert into teams (id, org_id, name) values ('team.demo','org','Demo Team') on conflict (id) do nothing;
insert into projects (id, team_id, name, okrs_required) values ('$PROJ','team.demo','Demo OKR Project',true) on conflict (id) do nothing;
insert into enrollment_codes (code, team_id, scopes) values ('$CODE','team.demo','["$PROJ"]'::jsonb);
insert into objectives (project_id, title, status) values ('$PROJ','phase2 objective','active') returning id;
SQL
)
if echo "$OBJ" | grep -qE '^[0-9a-f-]{36}$'; then pass "seeded okr project + objective ($OBJ)"; else fail "seed (got: $OBJ)"; fi

# 2. Ensure the gateway is up (self-start, robust cleanup — see phase1.sh).
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

# 3. Enroll an agent scoped to the okr project.
TOK=$(curl -s -X POST "$API/v1/intent/agent.enroll" -H 'content-type: application/json' \
  -d "{\"code\":\"$CODE\",\"display_name\":\"phase2-agent\"}" | sed -n 's/.*"raw":"\(syn_[^"]*\)".*/\1/p')
if echo "$TOK" | grep -q '^syn_'; then pass "enrolled (${TOK:0:14}...)"; else fail "enroll"; fi

auth=(-H "authorization: Bearer $TOK" -H 'content-type: application/json')

# 4. Open a workflow bound to the objective -> bd_id.
BD=$(curl -s -X POST "$API/v1/intent/workflow.create" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"workflow_class\":\"investigation\",\"title\":\"phase2 run\",\"target_objective_id\":\"$OBJ\"}" \
  | sed -n 's/.*"bd_id":"\(memos-[^"]*\)".*/\1/p')
if echo "$BD" | grep -qE '^memos-[0-9a-f]{8}$'; then pass "workflow.create -> $BD"; else fail "workflow.create bd_id"; fi

# 5. checkin start -> ok.
S=$(curl -s -X POST "$API/v1/intent/checkin" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"bd_id\":\"$BD\",\"status\":\"start\",\"current_task\":\"begin\",\"target_objective_id\":\"$OBJ\"}")
echo "$S" | grep -q '"ok":true' && pass "checkin start ok" || fail "checkin start (got: $S)"

# 6. checkin complete -> ok.
C=$(curl -s -X POST "$API/v1/intent/checkin" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"bd_id\":\"$BD\",\"status\":\"complete\",\"current_task\":\"done\",\"target_objective_id\":\"$OBJ\"}")
echo "$C" | grep -q '"ok":true' && pass "checkin complete ok" || fail "checkin complete (got: $C)"

# 7. The run moved to complete.
ST=$(docker compose exec -T db psql -U postgres -d memos -t -A \
  -c "select status from workflow_runs where bd_id='$BD';" 2>/dev/null | tr -d '[:space:]')
[ "$ST" = "complete" ] && pass "run status -> complete" || fail "run status (got: $ST)"

# 8. okrs binding rule: workflow.create with no objective -> rejected.
N=$(curl -s -X POST "$API/v1/intent/workflow.create" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"workflow_class\":\"x\",\"title\":\"unbound\"}")
echo "$N" | grep -q '"ok":false' && pass "no-objective workflow rejected" || fail "no-objective reject (got: $N)"

# Clean up this run's rows.
docker compose exec -T db psql -U postgres -d memos -q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
delete from checkins where bd_id='$BD';
delete from workflow_runs where bd_id='$BD';
delete from objectives where id='$OBJ';
delete from agents where display_name='phase2-agent';
delete from enrollment_codes where code='$CODE';
SQL

echo "=== Phase 2 summary ==="
if [ "$fails" -eq 0 ]; then echo "ALL CHECKS PASS"; exit 0; else echo "$fails CHECK(S) FAILED"; exit 1; fi

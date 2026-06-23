#!/usr/bin/env bash
# Phase 6 manual test — briefs, questions, governance worker, over HTTP.
#   enroll -> brief.fetch baseline -> seed an evidence-less medium learning (bypassing the gate)
#   -> run the evidence critic worker -> brief.fetch shows a new compliance brief -> ack it ->
#   it's gone next fetch -> question.ask -> question.answer -> the answer surfaces as a brief.
#
# Run from the repo root in Git Bash:  bash testing/phase6.sh
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
API="http://127.0.0.1:8787"

fails=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; fails=$((fails + 1)); }

echo "=== MemOS Phase 6 ==="

PROJ="project.demo"
CODE="enr_code_phase6_$(date +%s)_$$"

docker compose exec -T db psql -U postgres -d memos -q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
insert into orgs (id, name) values ('org','Demo Org') on conflict (id) do nothing;
insert into teams (id, org_id, name) values ('team.demo','org','Demo Team') on conflict (id) do nothing;
insert into projects (id, team_id, org_id, name, okrs_required) values ('$PROJ','team.demo','org','Demo Project',false) on conflict (id) do nothing;
insert into enrollment_codes (code, team_id, org_id, scopes) values ('$CODE','team.demo','org','["$PROJ"]'::jsonb);
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
  -d "{\"code\":\"$CODE\",\"display_name\":\"phase6-agent\"}")
TOK=$(echo "$ENR" | sed -n 's/.*"raw":"\(syn_[^"]*\)".*/\1/p')
AGENT=$(echo "$ENR" | sed -n 's/.*"agent_id":"\([^"]*\)".*/\1/p')
echo "$TOK" | grep -q '^syn_' && pass "enrolled ($AGENT)" || fail "enroll"
auth=(-H "authorization: Bearer $TOK" -H 'content-type: application/json')

# Baseline fetch.
BF0=$(curl -s -X POST "$API/v1/intent/brief.fetch" "${auth[@]}" -d "{\"project_id\":\"$PROJ\"}")
echo "$BF0" | grep -q '"briefs"' && pass "brief.fetch baseline ok" || fail "brief.fetch baseline (got: $BF0)"
echo "$BF0" | grep -q 'Evidence gate' && fail "compliance brief present before critic" || pass "no compliance brief yet"

# Open a run and seed an evidence-less MEDIUM learning directly (bypassing the API gate).
BD=$(curl -s -X POST "$API/v1/intent/workflow.create" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"workflow_class\":\"investigation\",\"title\":\"phase6 run\"}" \
  | sed -n 's/.*"bd_id":"\(memos-[^"]*\)".*/\1/p')
docker compose exec -T db psql -U postgres -d memos -q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
insert into learnings (project_id, bd_id, agent_id, claim, applies_to, confidence)
values ('$PROJ','$BD','$AGENT','unbacked medium claim from phase6','{phase6}','medium');
SQL
[ $? -eq 0 ] && pass "seeded evidence-less medium learning" || fail "seed learning"

# Run the evidence critic worker.
pnpm --filter @memos/workers run critic:evidence >/tmp/memos-critic.log 2>&1
grep -q 'filed=' /tmp/memos-critic.log && pass "critic worker ran" || fail "critic worker (see /tmp/memos-critic.log)"

# A compliance brief should now appear, and be first (newest).
BF1=$(curl -s -X POST "$API/v1/intent/brief.fetch" "${auth[@]}" -d "{\"project_id\":\"$PROJ\"}")
echo "$BF1" | grep -q 'Evidence gate' && pass "compliance brief appears after critic" || fail "no compliance brief (got: $BF1)"
BRIEF=$(echo "$BF1" | sed -n 's/.*"briefs":\[{"id":"\([0-9a-f-]*\)".*/\1/p')

# Ack it, then it should be gone next fetch.
curl -s -X POST "$API/v1/intent/brief.ack" "${auth[@]}" -d "{\"brief_id\":\"$BRIEF\"}" | grep -q '"acked":true' \
  && pass "brief.ack ok" || fail "brief.ack"
BF2=$(curl -s -X POST "$API/v1/intent/brief.fetch" "${auth[@]}" -d "{\"project_id\":\"$PROJ\"}")
echo "$BF2" | grep -q 'Evidence gate' && fail "compliance brief still present after ack" || pass "acked brief gone next fetch"

# Question round-trip: ask -> answer -> the answer comes back as a brief.
QID=$(curl -s -X POST "$API/v1/intent/question.ask" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"subject\":\"scaling\",\"body\":\"how many replicas?\"}" \
  | sed -n 's/.*"question_id":"\([0-9a-f-]*\)".*/\1/p')
[ -n "$QID" ] && pass "question.ask -> $QID" || fail "question.ask"
curl -s -X POST "$API/v1/intent/question.answer" "${auth[@]}" \
  -d "{\"project_id\":\"$PROJ\",\"question_id\":\"$QID\",\"answer\":\"start with three replicas\"}" \
  | grep -q '"brief_id"' && pass "question.answer ok" || fail "question.answer"
BF3=$(curl -s -X POST "$API/v1/intent/brief.fetch" "${auth[@]}" -d "{\"project_id\":\"$PROJ\"}")
echo "$BF3" | grep -q 'three replicas' && pass "answer surfaced as a brief" || fail "answer brief (got: $BF3)"

# Cleanup.
docker compose exec -T db psql -U postgres -d memos -q >/dev/null 2>&1 <<SQL
delete from brief_acks where agent_id='$AGENT';
delete from briefs where author_id in ('critic.evidence','$AGENT');
delete from questions where project_id='$PROJ';
delete from learnings where bd_id='$BD';
delete from workflow_runs where bd_id='$BD';
delete from agents where display_name='phase6-agent';
delete from enrollment_codes where code='$CODE';
SQL

echo "=== Phase 6 summary ==="
if [ "$fails" -eq 0 ]; then echo "ALL CHECKS PASS"; exit 0; else echo "$fails CHECK(S) FAILED"; exit 1; fi

#!/usr/bin/env bash
# Phase 10 — deployment artifacts, proven LOCALLY (no cloud, no cost). Builds the production API
# image (infra/deploy/Dockerfile), runs it against the docker-compose Postgres on an injected PORT,
# and asserts the container self-migrated + self-seeded by smoke-testing intents through it. Then a
# config/drift lint over render.yaml / vercel.json / the workflows / .env.example.
#
# Run from the repo root in Git Bash:  bash testing/phase10.sh
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

IMAGE="memos-api:phase10"
NAME="memos-api-phase10"
PORT=9099
API="http://127.0.0.1:${PORT}"
# Must match the token the local compose DB's operator agent was seeded with — the container's seed
# is idempotent (onConflictDoNothing), so it won't overwrite an existing operator's token hash.
TOKEN="syn_demo_operator_0000000000000000"

fails=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; fails=$((fails + 1)); }

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "=== MemOS Phase 10 (deploy artifacts) ==="

# --- 0. infra up (Postgres only; the image needs no MinIO/Redis at boot) ---
docker compose up -d db >/dev/null 2>&1
for _ in $(seq 1 30); do
  docker compose exec -T db pg_isready -U postgres -d memos >/dev/null 2>&1 && break
  sleep 1
done
docker compose exec -T db pg_isready -U postgres -d memos >/dev/null 2>&1 \
  && pass "compose Postgres ready" || fail "compose Postgres not ready"

# --- 1. build the production image ---
echo "building image (this can take a couple of minutes the first time)…"
if docker build -f infra/deploy/Dockerfile -t "$IMAGE" . >/tmp/memos-p10-build.log 2>&1; then
  pass "docker image builds"
else
  fail "docker image builds (see /tmp/memos-p10-build.log)"
  tail -25 /tmp/memos-p10-build.log
  echo "=== Phase 10 summary ==="; echo "$fails CHECK(S) FAILED"; exit 1
fi

# --- 2. run the container against the compose DB, on an injected PORT ---
# host.docker.internal reaches the host's published 5432 (Docker Desktop auto; --add-host covers Linux).
cleanup
docker run -d --name "$NAME" \
  --add-host=host.docker.internal:host-gateway \
  -p "${PORT}:${PORT}" \
  -e "PORT=${PORT}" \
  -e "MEMOS_OPERATOR_TOKEN=${TOKEN}" \
  -e "DATABASE_URL=postgres://postgres:postgres@host.docker.internal:5432/memos" \
  -e "MEMOS_APP_DATABASE_URL=postgres://memos_app:memos_app@host.docker.internal:5432/memos" \
  "$IMAGE" >/dev/null 2>&1 \
  && pass "container started" || fail "container started"

# --- 3. health on the injected port (proves server.ts honors PORT) ---
healthy=0
for _ in $(seq 1 45); do
  if curl -sf "${API}/health" >/dev/null 2>&1; then healthy=1; break; fi
  sleep 1
done
if [ "$healthy" -eq 1 ]; then
  pass "GET /health 200 on injected PORT=${PORT}"
else
  fail "GET /health on PORT=${PORT}"
  echo "--- container logs ---"; docker logs "$NAME" 2>&1 | tail -30
fi

# --- 4. smoke intents THROUGH the container (proves entrypoint migrated + seeded inside the image) ---
ME=$(curl -s -X POST "${API}/v1/intent/agent.me" -H "authorization: Bearer ${TOKEN}" -H "content-type: application/json" -d '{}' 2>/dev/null)
echo "$ME" | grep -q '"ok":true' \
  && pass "agent.me ok (operator seeded by container entrypoint)" \
  || { fail "agent.me"; echo "  resp: $ME"; }

OBJ=$(curl -s -X POST "${API}/v1/intent/objective.query" -H "authorization: Bearer ${TOKEN}" -H "content-type: application/json" -d '{"project_id":"project.demo"}' 2>/dev/null)
# a0000000-… is a seeded objective id — its presence proves migrate+seed ran in the image.
echo "$OBJ" | grep -q 'a0000000-0000-4000-8000' \
  && pass "objective.query returns seeded OKRs" \
  || { fail "objective.query (no seeded objective)"; echo "  resp: $(echo "$OBJ" | head -c 200)"; }

# --- 5. redeploy idempotency: restart re-runs migrate+seed; must come back healthy ---
docker restart "$NAME" >/dev/null 2>&1
healthy=0
for _ in $(seq 1 45); do
  if curl -sf "${API}/health" >/dev/null 2>&1; then healthy=1; break; fi
  sleep 1
done
[ "$healthy" -eq 1 ] \
  && pass "redeploy idempotent (restart → migrate+seed again → healthy)" \
  || { fail "redeploy idempotency"; docker logs "$NAME" 2>&1 | tail -20; }

# --- 6. config / drift lint (no cloud) ---
# the PORT fix is actually in the code
grep -q 'process.env.PORT' packages/api/src/server.ts \
  && pass "server.ts honors PORT" || fail "server.ts missing PORT handling"

# render.yaml: health check + the three secret env vars declared
RY="infra/deploy/render.yaml"
if grep -q 'healthCheckPath: /health' "$RY" \
   && grep -q 'key: DATABASE_URL' "$RY" \
   && grep -q 'key: MEMOS_APP_DATABASE_URL' "$RY" \
   && grep -q 'key: MEMOS_OPERATOR_TOKEN' "$RY"; then
  pass "render.yaml declares health check + secrets"
else
  fail "render.yaml missing health check or a secret key"
fi

# vercel.json is valid JSON
node -e "JSON.parse(require('fs').readFileSync('packages/web/vercel.json','utf8'))" >/dev/null 2>&1 \
  && pass "vercel.json is valid JSON" || fail "vercel.json invalid JSON"

# workflows present with the expected top-level keys
for wf in .github/workflows/ci.yml .github/workflows/critic.yml; do
  if [ -f "$wf" ] && grep -q '^jobs:' "$wf" && grep -q 'runs-on:' "$wf"; then
    pass "workflow ok: $(basename "$wf")"
  else
    fail "workflow malformed/missing: $wf"
  fi
done

# env drift: every deploy-critical var must be documented in .env.example
MISSING=""
for v in DATABASE_URL MEMOS_APP_DATABASE_URL MEMOS_OPERATOR_TOKEN MEMOS_API_URL MEMOS_PROJECT_ID SESSION_SECRET DEMO_PASSWORD MINIO_ENDPOINT MINIO_BUCKET; do
  grep -q "^${v}=\|${v}" .env.example || MISSING="$MISSING $v"
done
[ -z "$MISSING" ] \
  && pass ".env.example documents all deploy-critical vars" \
  || fail ".env.example missing:${MISSING}"

echo "=== Phase 10 summary ==="
if [ "$fails" -eq 0 ]; then echo "ALL CHECKS PASS"; exit 0; else echo "$fails CHECK(S) FAILED"; exit 1; fi

#!/usr/bin/env sh
# MemOS API container entrypoint: self-provision the database, then serve.
#
#   1) migrate as the OWNER (DATABASE_URL) — creates the vector/pgcrypto extensions, the non-owner
#      memos_app role, tables, and RLS policies. Idempotent: drizzle tracks applied migrations.
#   2) seed as the OWNER (DATABASE_URL) — demo org/project + the OPERATOR agent whose token hash is
#      derived from MEMOS_OPERATOR_TOKEN (the dashboard authenticates as this agent). Idempotent:
#      fixed ids + onConflictDoNothing, so every redeploy is safe.
#   3) serve as memos_app (MEMOS_APP_DATABASE_URL) on $PORT.
#
# `set -e` aborts the boot if migrate or seed fails, so we never start serving a half-provisioned
# database. Run from the image WORKDIR (/app); paths are relative to the repo root.
set -e

echo "[entrypoint] applying migrations (owner connection)…"
tsx packages/api/src/db/migrate.ts

# Seed the demo data + the operator agent the dashboard logs in as. On by default so the hosted
# demo comes up populated with zero extra config; set MEMOS_SEED=false for a non-demo production
# instance (you then enroll your own agents and create your own operator). Idempotent either way.
if [ "${MEMOS_SEED:-true}" = "true" ]; then
  echo "[entrypoint] seeding demo data (idempotent; MEMOS_SEED=false to skip)…"
  tsx packages/api/src/db/seed.ts
else
  echo "[entrypoint] MEMOS_SEED=false — skipping demo seed."
fi

echo "[entrypoint] starting gateway on port ${PORT:-${MEMOS_PORT:-8787}}…"
exec tsx packages/api/src/server.ts

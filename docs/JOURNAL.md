# MemOS — Build Journal

One short paragraph per working session: what was built and why. Newest at the bottom.

---

## 2026-06-14 — Phase 0: repo + infra skeleton

Stood up the foundation with zero business logic. Scaffolded the pnpm monorepo
(`packages/{api,web,workers,shared}`, `sdk/`, root scripts that fan out with
`-r --if-present` so empty stub packages don't break `pnpm typecheck`), TypeScript on
NodeNext (api/shared real TS packages; web/workers stubs), Vitest with `passWithNoTests`,
and a root `docker-compose.yml` (Postgres `pgvector/pgvector:pg16` as service `db`, MinIO,
Redis) placed at the repo root because the phase scripts call `docker compose` with no `-f`.

The core of Phase 0 is the **full Drizzle schema** (`packages/api/src/db/schema.ts`) for all
17 tables from `DATA_MODEL.md`, and three migrations in load-bearing order:
`0000_prereqs.sql` (hand-authored: `CREATE EXTENSION vector/pgcrypto` + the non-owner
`memos_app` role — drizzle-kit never emits `CREATE EXTENSION`, and the `vector(1536)`
columns can't parse without it), `0001_init.sql` (generated: tables, btree + `gin(applies_to)`
indexes, check constraints, the provenance FKs), and `0002_rls.sql` (hand-authored:
`ENABLE`+`FORCE` RLS, 4 policies, and GRANTs for the 9 project-scoped tables; control-plane
and identity-targeted tables get GRANTs only). The migrator (`src/db/migrate.ts`) runs as the
owner via tsx with an ESM-safe `fileURLToPath` path to `infra/migrations` and a connect-retry
loop. Two decisions captured as ADRs: **001** (single intent-RPC endpoint over REST) and
**002** (RLS isolation via a non-owner app role + `FORCE`, which is the only way owners don't
silently bypass the policy).

Decisions worth recording: added a denormalized `project_id` to `milestones` and `choices`
(the spec scopes them indirectly) so the uniform RLS template applies — `DATA_MODEL.md`
updated to match, since code is the source of truth. Env loading was centralized in
`src/env.ts` to always resolve the repo-root `.env` regardless of cwd (caught because
`pnpm db:migrate` runs in `packages/api`), and connection hosts switched to `127.0.0.1` to
dodge Node's IPv6-first `localhost` resolution against Docker's IPv4 port publish.

Environment note: this machine had no Docker (and no WSL2) and no pnpm at the start. Installed
pnpm; Docker Desktop + WSL2 is being installed operator-side. So the **static half** of the
exit gate is green now — `pnpm install`, `pnpm typecheck`, `pnpm test`, migration generation
in correct journal order, and the migrator failing only at DB connection (proving code/path/env
are sound). The **runtime half** (`docker compose up`, `pnpm db:migrate` against a live DB,
`testing/phase0.sh`) is pending Docker and will be closed with the operator before the box is
checked.

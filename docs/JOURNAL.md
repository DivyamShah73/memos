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
pnpm; the operator installed WSL2 + Docker Desktop. The **static half** of the gate went green
first (`pnpm install`/`typecheck`/`test`, migration generation in correct journal order, the
migrator failing only at DB connection). Then a real infra snag: `docker compose up` couldn't
pull any image — every layer dropped mid-transfer with `EOF` from `production.cloudfront.docker.com`.
Isolated it carefully: the host downloaded 10MB fine and the WSL2 VM downloaded 10MB from
Cloudflare fine, so it wasn't the network or MTU (tried 1480→1400→1280, no change) — it was
Docker Hub's CloudFront CDN specifically. Fix: pulled the three images through Google's Docker
Hub mirror (`mirror.gcr.io`) and re-tagged them to the canonical names compose expects. (Worth
making persistent later via `registry-mirrors` in Docker's daemon.json.)

**Phase 0 gate is now fully GREEN.** `docker compose up` brings up db/minio/redis (db+redis
healthy, MinIO console 200 at :9001); `pnpm db:migrate` applies 0000→0002 with no error and is
idempotent on re-run; `testing/phase0.sh` PASSes every one of the 17 tables plus the spot-checks
(`facts.embedding` is `vector(1536)`, FORCE RLS on, 4 policies); extensions `vector`+`pgcrypto`
and the `memos_app` login role are present; `pnpm typecheck` clean. The RLS *enforcement* proof
(agent A can't read project B, default-deny on unset GUC) is deferred to Phase 1, where the
gateway connects as `memos_app` and sets the per-request GUC — as ADR-002 lays out.

---

## 2026-06-15 — Phase 1: gateway core + auth + enrollment

Built the intent-RPC gateway. One Hono route `POST /v1/intent/:name` (+ `GET /health`) runs a
fixed pipeline in `core/dispatch.ts`: resolve the registry entry → **auth before resolution**
(any non-public intent with a missing/invalid bearer → 401, even an unimplemented one, so the
intent catalogue never leaks to anon callers) → rate-limit stub → 404 for unknown intents →
JSON parse (malformed → 400) → Zod `safeParse` (→ 400 with `detail.field_errors`) → handler.
The uniform envelope + a `statusFor` map live in `core/envelope.ts`, with the deliberate split
that business-rule failures are HTTP 200 `ok:false` (not 4xx). `app.ts` is exported separately
from `server.ts` so tests drive it in-process via `app.request()`.

`agent.enroll` is the first (and only public) intent. Token auth (ADR-003): `syn_` +
base64url(32 random bytes), stored only as `sha256` hex, looked up by hash with
`status='active'` filtered in SQL. Single-use is an atomic CAS —
`UPDATE … WHERE used_by IS NULL RETURNING` + the agent INSERT in the same transaction, with a
suffix-retry guarding the (astronomically unlikely) agent-id collision. The gateway connects as
the non-owner `memos_app` role (ADR-002); Phase 1 only touches the un-RLS'd control-plane
tables, so no per-request GUC yet (noted for Phase 2 in ADR-003). Zod schemas live in
`@memos/shared` and are barrel-exported (the package only exposes `"."`), with `zod` a dep of
both shared and api.

Gate green: `pnpm typecheck` clean; **8 Vitest cases pass** (happy path, hash-not-raw,
reused→ok:false, concurrent double-enroll→exactly-one-wins, invalid→ok:false, no-token
`workflow.create`→401, malformed→400+field_errors, non-JSON→400); and `testing/phase1.sh`
passes over real HTTP — it seeds a fresh code, self-starts the server with plain `tsx` (no
watch), and cleans up the process via `netstat`+`taskkill //T` (the `$!`-is-the-MSYS-pid trap
on Git Bash). `smoke_all.sh` now chains phase0 + phase1.

**Code-review pass** (xhigh workflow: 9 finder angles → verify → sweep). Nothing alarming;
the core was confirmed sound. Fixed six real findings: (1) the uniform-envelope invariant was
breakable — an auth-phase DB throw escaped to Hono's bare-text 500, so the whole dispatch is
now wrapped + an `app.onError` safety net always returns the envelope; (2) added a **unique
index** on `agents.api_token_hash` (migration 0003) — it's the per-request auth lookup and was
an O(rows) scan; (3) the rate-limit key trusted the spoofable `X-Forwarded-For` and collapsed
to one shared `"local"` bucket — now keyed on the actual connection address via
`getConnInfo` (trusted-proxy XFF is Phase 6); (4) the limiter Map is now size-bounded with
expired-entry eviction; (5) added a `bodyLimit` (8 MiB) so a huge body can't OOM the gateway
before any gate runs (covered by a 413 test → 9 tests now); (6) the test now uses test-owned
fixture ids (`org.vitest`/`team.vitest`) and a `finally` that always closes the pools, so
re-runs can't FK-collide with phase1.sh's `org`/`team.demo`. Also hardened the migrator to
retry Postgres `57P03`/class-08 (transient "in recovery"/connection) errors, not just Node
socket errors. Enrollment-code *expiry* (a finder note) is deferred — it's not in the data
model; a future enhancement.

**Infra reliability fix:** the Postgres data dir was bind-mounted to the Windows filesystem
(`./infra/data/postgres`); on Docker Desktop/WSL2 the 9p bridge is slow and crash-prone for a
DB's fsync IO — it caused a backend crash + a multi-minute crash-recovery mid-session. Switched
`db`/`minio`/`redis` to **named Docker volumes** (in the WSL2 ext4 filesystem) and re-migrated
from scratch (no real data lost). The DB is stable since.

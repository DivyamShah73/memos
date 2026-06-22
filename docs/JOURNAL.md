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

---

## 2026-06-15 — Phase 2: workflow + checkin (the provenance spine)

Added `workflow.create` (→ `bd_id`) and `checkin`, and — the real work — **wired per-request
RLS** (ADR-004). `core/scope.ts` exposes an agent-bound `ctx.withScope(fn)` that runs DB work
in a transaction whose first statement is `set_config('memos.agent_projects', '{…}', true)`;
postgres-js pins the tx to one connection, so `SET LOCAL` is transaction-scoped and never
leaks across the pool. RLS'd reads (objectives, workflow_runs) go through `withScope`; the raw
`gatewayDb` is only for the un-RLS'd control-plane tables. Handlers also do an explicit
`project_id ∈ scopes` 403 pre-check — load-bearing, because an out-of-scope INSERT trips RLS
`WITH CHECK` and *throws* `42501` (a 500), so the pre-check is what yields a clean 403 (with a
`42501` backstop). `bd_id` = `memos-`+8 hex with a 23505 retry; the run carries `agent_id` for
provenance. `workflow.create` enforces the okrs binding rule ("…is abandoned; cannot bind"
verbatim) reading the objective in-scope; `checkin` looks the run up in-scope (RLS hides other
tenants → "unknown workflow run"), asserts `run.projectId === project_id` (closes an
intra-scope hole), rejects closed runs, and closes the run on complete/failed.

The **tenant-isolation test** is the headline: agent A can't create in B (403) and can't see
B's run (invisible), plus two GUC-proof assertions (no-scope read → `[]`, scoped read → row)
so it can't pass for the wrong reason. That GUC-proof immediately **caught a real latent bug**:
`current_setting('memos.agent_projects', true)::text[]` raises `malformed array literal: ""` on
a *reused* pooled connection, because a custom dotted GUC reverts to `''` (not NULL) after a
`SET LOCAL`. Migration **0004** hardens all 36 policies to `nullif(current_setting(…), '')::text[]`
so unset and empty both default-deny cleanly. Also corrected a real **doc defect**: ADR-002 and
`seed.ts` claimed the owner-run seed must set the GUC because "FORCE binds the owner" — false
for our config, since the owner is the `postgres` *superuser* (bypasses RLS unconditionally;
FORCE only binds a non-superuser table-owner). Fixtures seed cross-tenant data with no GUC.

Gate green: `pnpm typecheck` clean; **26 tests** (5 files, incl. the isolation + GUC proofs;
DB-integration files run sequentially via `fileParallelism:false` to avoid fixture races);
`testing/phase2.sh` passes the full loop over HTTP (enroll → workflow.create bound to an
objective → start/complete checkins → run closed; unbound workflow rejected). `smoke_all`
now chains phases 0–2.

**Code-review pass** (xhigh) caught a real cluster in the provenance spine — all fixed: (1)
**the alarming one** — `target_objective_id` was only validated inside `if (okrs_required)`, so
on a non-okrs project a supplied objective was inserted unchecked; a *foreign-tenant* objective
UUID passes the FK (FK checks bypass RLS) → a cross-tenant provenance binding (invariants #3/#4),
and a non-existent UUID → FK 23503 → uncaught → 500. Fix: validate the objective **whenever
supplied**, in-scope — a foreign objective is RLS-invisible (→ "not found", no binding) and a
bogus one is a clean business error. (2) `checkins.target_objective_id` had **no FK** (unlike
`workflow_runs`) → added it (migration 0005) as a DB backstop. (3) checkin compared the UUID
with case-sensitive JS `!==` vs Postgres's lowercase → an uppercase UUID wrongly rejected; now
lowercased. (4) checkin gated on the **live `projects.okrs_required` flag** → flipping it
mid-run bricked an open run forever; now the objective rule **derives from the run's binding**
(immutable since creation), and checkin no longer reads `projects` at all (one fewer round-trip).
(5) **TOCTOU** on close — a non-locking read + unconditional UPDATE let concurrent terminal
checkins double-close; now `SELECT … FOR UPDATE` + a `status='open'` guard on the close. checkin
also now stores the run's canonical objective on the checkin (always valid). Re-verified: 29
tests (added cross-tenant-binding rejection, non-okrs validation, concurrent-close
serialization), typecheck clean, `smoke_all` green.

---

## 2026-06-15 — Phase 3: artifacts + evidence-gated writes (THE core invariant)

The load-bearing phase. `artifact.upload` stores evidence bytes in MinIO (S3 via
`@aws-sdk/client-s3`, `forcePathStyle`, lazy-memoized `ensureBucket`) at
`{project_id}/{uuid}`; only `bucket_path` + `sha256` + `size_bytes` land in Postgres — the
bytes never do. Ordering is deliberate: **PutObject runs outside the DB transaction, blob
before row**, so a long S3 RTT can't pin a pooled connection/locks, and the only possible
orphan is a harmless unreferenced blob (a Phase-4 sweep GCs it) — never a row pointing at no
blob. `fact.record` / `learning.record` are batched + evidence-gated in **both layers**: the
Zod schema `superRefine`s each item (`confidence ≥ medium ⇒ evidence_artifact_id`, learnings
also `non_obvious_marker ≥ 15` — pushing the array index into the issue path so
`detail.field_errors` reads `facts.0.evidence_artifact_id` → 400), and a shared
`intents/_evidence.ts` helper re-checks in the handler AND validates the cite with one
in-scope `SELECT artifacts WHERE id AND project_id AND bd_id` — never the FK alone (it
resolves a foreign-tenant id globally). 0 rows covers non-existent + cross-tenant + wrong-run.
Batches are all-or-nothing in one `withScope` tx; embeddings stay NULL (Phase 4).

Gate green: `pnpm typecheck` clean; **40 tests** (the invariant `evidence-gate.test.ts`: low
no-ev ACCEPTED, medium no-ev → 400, high learning no-marker → 400, marker<15 → 400,
non-existent cite → ok:false, **cross-tenant cite → ok:false**, evidence-backed fact/learning
ACCEPTED; `artifact.upload.test.ts`: sha256 roundtrip from MinIO + `information_schema` proof
of no `bytea` column). `testing/phase3.sh` runs the loop over HTTP and proves the gate (medium
no-evidence rejected, with-evidence accepted, bytes not in Postgres). `smoke_all` now chains
0–3.

---

## 2026-06-15 — Phase 4: query (find what's stored)

`fact.query` / `learning.query` make the store readable so an agent can check before
re-deriving. Baseline is **Postgres full-text search** (pgvector stays the documented
cut-line). `plainto_tsquery('english', …)` (safe on arbitrary input — no tsquery operators,
no injection) matched against `to_tsvector('english', claim)`, ranked by `ts_rank` then (for
learnings) `reuse_success_count` then recency. The expression gin indexes
(`facts_claim_fts_idx` / `learnings_claim_fts_idx`) are **hand-authored SQL** in migration 0006
(like the RLS policies — drizzle-kit churns expression gin indexes; `drizzle-kit generate`
confirms no diff), and a tiny `_fts.ts` centralizes the `'english'` regconfig so the index and
query expressions can't drift (or the planner silently stops using the index). Queries run
**inside `withScope`** (RLS) with an **explicit `project_id` filter** (RLS permits all the
agent's projects; the intent targets one) — so a query in A can never see B. `learning.query`
takes an optional `applies_to` tag filter via drizzle's `arrayOverlaps` (the raw
`&& $1::text[]` form mis-binds the JS array). Responses are mapped to snake_case and never
include `embedding`.

Gate green: typecheck clean; **53 tests** (11 new across fact.query/learning.query: keyword
relevance returns the match not the others, descending `score`, `applies_to` narrowing, `limit`,
missing-query → 400, and **project-scope isolation** — A's query never returns B's matching row
while still returning A's own, which doubles as the GUC-is-set proof). `testing/phase4.sh`
proves keyword search over HTTP (match returned, irrelevant query excluded); `smoke_all` now
chains 0–4. That's the **Day-1 backend query layer** done.

**Code-review pass** (Sonnet, medium) — nothing alarming; fixed two real findings and one
cheap nit. (1) **whitespace-only query bypass**: `z.string().min(1)` admitted `"   "`, and
`plainto_tsquery('english','   ')` yields an *empty* tsquery — which `@@` treats as matching
every row, so the query would silently dump the whole project instead of keyword-matching.
Fixed with `z.string().trim().min(1)` in both query schemas (`.trim()` runs before the length
check), plus a regression test in each (`"   "` → 400). (2) **dead RLS catch on a SELECT**:
both query handlers wrapped the read in `try/catch isRlsViolation → 403`, but a SELECT under
RLS just returns 0 rows — it never raises 42501 (only a write `WITH CHECK` or a revoked GRANT
does), so the catch was dead code that would have masked a real infra failure as a benign 403.
Removed it from both, with a comment on why SELECTs don't need it. (3) tightened
`learning.query`'s `applies_to` to `.min(1)` so an empty array can't slip through as a no-op
filter. Re-verified: typecheck clean, **55 tests** green, `smoke_all` 0–4 green.

---

## 2026-06-22 — Phase 5: OKRs (goals + rollups)

The goal layer the operator steers the fleet with. Five intents — `objective.publish` /
`objective.query` / `objective.update`, `milestone.achieve`, `key_result.update` — over the
`objectives` + `milestones` tables that Phase 0 already created (one table, two roles: a
`milestones` row with a `metric_target` is a **key result**, without it a plain milestone). So
**no migration** — the RLS policies + `memos_app` grants for both tables were already in
0002/0004; this phase is schemas + handlers + rollup math + tests, all on the established
write/query patterns (`withScope` + explicit `project_id` filter, `assertRunWritable` /
`assertEvidence` reused from `_evidence.ts`, the `42501`-backstop catch on writes, none on the
read-only `objective.query`).

The real work is the **rollup math** (`intents/_okr.ts`, pinned in **ADR-005**): progress is one
float in `[0,1]`. A KR is `current/target` (`up`) or `target/current` (`down`, lower-is-better),
clamped, div-by-zero guarded; an explicitly achieved item is `1` regardless of metric; an
objective with sub-OKRs is the **weight-normalized mean of its children**, with abandoned/
superseded children **excluded** from both numerator and denominator (descoping a branch
mustn't drag the parent down); a leaf objective is the equal mean of its milestones. Postgres
`numeric` columns come back as **strings** from postgres-js, so every value is `Number()`'d in
that one file — the single place math happens, so handlers and tests can't drift. The achieve /
kr-update handlers recompute the parent rollup via a shared `recomputeObjectiveProgress` (the one
DB-touching helper) after their write. Two product calls (operator-confirmed): milestone
achievement **is evidence-gated** like fact/learning (medium/high ⇒ `evidence_artifact_id` in the
same project+run); `key_result.update` **never auto-achieves** at 100% — hitting a number isn't
proof, achievement is the explicit gated act.

Two correctness details worth noting: `objective.publish` validates a sub-OKR's `parent_id`
in-scope (RLS hides another tenant's → "not found") and rejects an abandoned/superseded parent,
mirroring the workflow.create binding rule; and `_testutil` `cleanupAndClose` had a latent FK
trap (it never deleted `milestones`, and a bulk objectives delete can violate the self-FK
`parent_id`/`supersedes_id` mid-statement) — now it deletes milestones first and NULLs the
self-FKs before the objectives delete.

Gate green: `pnpm typecheck` clean; **79 tests** (24 new across the 5 OKR suites: weighted
rollup excluding abandoned children, up/down metric progress with exact expected values, the
evidence gate on `milestone.achieve` incl. a cross-tenant cite → `ok:false`, already-achieved →
`ok:false`, and **abandon-then-can't-bind** which re-verifies the Phase-2 invariant cross-phase).
`testing/phase5.sh` proves the loop over HTTP (publish → KR to 45/90 → query rollup 0.25 →
achieve → medium-without-evidence rejected). `testing/demo_day1.sh` is the **Day-1 capstone**:
one script running the entire agent loop end-to-end (enroll → workflow → checkin → artifact →
evidence-gated fact + learning → query → publish OKR → kr.update → achieve → checkin complete)
and asserting an evidence-less medium write is rejected. `smoke_all` now chains 0–5. **Day 1 is
done** — the full backend agent loop works end-to-end with the core invariant holding.

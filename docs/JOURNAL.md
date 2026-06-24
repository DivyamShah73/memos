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

---

## 2026-06-22 — Phase 6: briefs, questions, governance worker

Day 2 opens with the **steering layer** + the first **autonomous governance**. Four intents —
`brief.fetch` / `brief.ack`, `question.ask` / `question.answer` — plus two on-demand workers
(`critic:evidence`, `briefs:escalate`). No new tables (Phase 0 built `briefs`/`brief_acks`/
`questions`); the load-bearing change is finally giving briefs their **DB-level isolation**.

Briefs are **identity-targeted** (org/team/project/agent), so the `memos.agent_projects` GUC
doesn't fit. **ADR-006**: a second request-local GUC `memos.agent_identity` =
`{agent.x, team.x, org, project.*}`, set alongside the project GUC in `makeWithScope`; the
`briefs_select` policy is a single `target_id = ANY(identity)` membership test (the four id
namespaces never collide, so no `target_kind` match needed). `resolveAgent` now left-joins
`teams` for `orgId`. **Read-isolation is the boundary; INSERT is `WITH CHECK (true)`** — a brief
is an outbound instruction, and `question.answer` files one targeting a *different* agent (the
asker), so an identity-scoped write-check would wrongly reject it; there's no UPDATE/DELETE
policy, so supersession is a new insert with `supersedes_id`. `brief.fetch` adds an explicit
`(target_kind <> 'project' OR target_id = :project_id)` narrowing on top of RLS (the identity set
spans all the agent's projects; a fetch targets one), hides superseded briefs, and — unless
`include_acked` — hides acked ones; it also returns the project's `active_okrs` (reusing the
`_okr.ts` rollup).

The governance worker *brains* live in **`packages/api/src/governance/`** (typed, owner-db, with
colocated tests against the real `_testutil` fixtures); `packages/workers` holds thin tsx runner
shims that import them via a new `@memos/api/governance` export. Running as the **owner**
(superuser) is deliberate — governance is a fleet-wide sweep that bypasses RLS — and the briefs
it files are still read-isolated when agents fetch. `runEvidenceCritic` scans every project's
facts+learnings for the evidence-gate violation (`confidence ≥ medium ∧ no evidence`) the API
write-path forbids but a direct/seeded insert can introduce, and files a brief at the offender;
it's idempotent via a stable in-body marker. `runBriefEscalation` escalates agent briefs unacked
for >24h to the agent's team (`now` injectable for tests).

Gate green: `pnpm typecheck` clean; **97 tests** (15 new: brief targeting incl. the
**another-team-can't-see-it** identity-RLS proof, supersede/ack hiding, the question round-trip
surfacing as a brief, the critic filing + idempotency, escalation skipping acked/fresh briefs);
`drizzle-kit generate` no-diff (0007 is hand-authored RLS, like 0002/0004). `testing/phase6.sh`
proves the loop over HTTP (seed an unbacked medium learning → run the critic worker → a
compliance brief appears → ack → gone → question round-trip). `smoke_all` now chains 0–6.

---

## 2026-06-23 — Phase 7: Dashboard core (the showpiece, part 1)

The backend goes **visible**. A Next.js 15 (App Router) operator console with an **OKR tree**
(weighted rollup bars) and a **live activity feed** that updates in real time as agents write.
**ADR-007** pins the two architecture calls: the local stack has no Supabase and no operator
table, so (1) the dashboard reads **through the gateway** — the Next.js *server* calls the intent
endpoints as a seeded **operator agent** (an ordinary `agents` row scoped to `project.demo`),
token held in a non-`NEXT_PUBLIC_` env var so it never reaches the browser; the UI is therefore
bound by the *same* RLS + evidence rules as any agent, reusing all the isolation work. And (2) the
live feed is **Server-Sent Events** from the gateway fed by an in-process event bus
(`core/events.ts`): the write handlers `publishActivity` **after commit**, a `GET
/v1/stream/activity` route streams project-filtered frames, and a Next.js `/api/stream` route
proxies it with the operator token (token stays server-side). Two small read intents support the
UI — `activity.recent` (the feed's initial page, a scoped union of recent checkins/facts/
learnings) and `agent.me` (the operator's scopes). Login is a lightweight signed-cookie demo gate
(`DEMO_PASSWORD` + HMAC), explicitly not production auth.

Two gotchas worth noting: the demo seed (`pnpm db:seed`) hung until it closed the postgres-js
pool + `process.exit` (an open pool keeps the event loop alive); and the Next **edge** middleware
can't import `node:crypto`, so the session-cookie *name* had to move to a crypto-free module the
middleware imports (the HMAC stays in the Node-runtime `session.ts`).

Gate green: `pnpm typecheck` clean (web now in the fan-out); `pnpm --filter @memos/api test` →
**102** still green; `pnpm --filter @memos/web build` clean; `testing/phase7.sh` proves the
read surface + a live SSE frame over HTTP (post a fact → an `event: activity` frame arrives); and
**Playwright** drives the real browser end-to-end — log in → the seeded OKR tree renders → a fact
posted to the gateway **appears in the feed within ~1s without a refresh**. `smoke_all` now chains
0–7. The two showpieces (OKR rollups + the live feed) are live; the provenance graph is Phase 8.

---

## 2026-06-23 — Phase 8: provenance graph + governance views (showpiece, part 2)

The visual payoff of the whole `bd_id` spine. Four read/write intents + three dashboard views;
no migration (all data already exists). **`provenance.trace`** walks a learning's lineage —
learning → evidence artifact → workflow run → objective (OKR) → authoring agent — into
nodes/edges; **`learning.list`** ranks learnings by reuse (the picker); **`brief.create`** lets
an operator author a standing brief; **`trust.leaderboard`** ranks team agents by trust. The web
adds **`/provenance`** (a React Flow graph that lights up the chain when you click a learning;
selection is server-side via `?learning=<id>`), **`/leaderboard`**, and **`/briefs`** (a
server-action authoring form). The seed gained an evidence-backed, objective-bound, high-reuse
learning + three teammates with varied trust so the graph and leaderboard have real shape.

**Scope:** the 3 exit-gate views; token/member management deferred to Phase 9. **No new ADR** —
provenance.trace is a read view over the existing spine, and `brief.create`'s open-write is
already governed by ADR-006 (read-isolation is the boundary); the dashboard-via-gateway pattern
is ADR-007.

The headline find (a **real latent bug**, caught while testing `brief.create`): under FORCE RLS,
`INSERT ... RETURNING` re-applies the `briefs_select` policy, so returning a brief that targets
*someone other than the author* (the normal case) raised a spurious `42501`. The same bug lurked
in `question.answer` (it only passed because its tests self-target). Fixed both by generating the
UUID in the handler and inserting it explicitly — no `RETURNING`.

Gate green: `pnpm typecheck` clean; `pnpm --filter @memos/api test` → 102 + the 4 new suites
(incl. the cross-agent brief round-trip + provenance chain node/edge assertions); web build clean;
`testing/phase8.sh` proves the chain + brief round-trip + leaderboard over HTTP; **Playwright**
clicks the high-reuse learning and asserts its objective + agent nodes render, and authors a brief
that appears in the list. `smoke_all` now chains 0–8. Day 2's dashboard is feature-complete.

---

## 2026-06-23 — Phase 9: SDK, rich seed, full e2e, README/polish (project complete)

The finale — turning a working system into one a reviewer (and an agent) can pick up in minutes.
**`@memos/agent`** is a full typed client: `MemosClient.enroll()` + a method per agent-facing
intent over the uniform envelope, throwing a typed `MemosError` on `ok:false` so callers use
try/catch. **`AGENTS.md`** is the agent manifest (the loop + the two gates + a quickstart). The
**rich demo seed** makes the dashboard look alive — two top-level OKRs with weighted sub-OKRs/KRs,
standing briefs (team/project/agent), a dozen+ facts/learnings/checkins across four agents with
varied trust, and two evidence-backed learnings for provenance depth.

The headline deliverable is the **SDK-driven end-to-end** (`testing/phase9.sh` →
`sdk/memos-agent/e2e/full-loop.ts`): the whole lifecycle over HTTP (enroll → briefs → workflow →
checkin → artifact → evidence-gated fact + learning → query → publish OKR → move KR → achieve →
close) plus the three core-invariant proofs — the evidence gate **rejects** an unbacked medium
write, a second agent gets **403** on another project and sees none of its facts (isolation), and
`"throughput ≤ 200ms — cost 🎯 hit"` **round-trips byte-intact** (the UTF-8 promise). The
**README** was rewritten as the showpiece: a Mermaid architecture diagram, four auto-captured
dashboard screenshots (a gated Playwright spec writes them to `docs/screenshots/`), the invariants
table, the agent loop, SDK quickstart, and the test-gated build story; `docs/DEMO_SCRIPT.md` is the
2-minute Loom shot-list (the recording itself is the operator's to make). Also folded in the three
Phase-8 review nits: a shared `ProgressBar`, a `getProjectId()` helper, and a try/catch around the
brief-authoring server action. No new ADR — Phase 9 adds a client, a manifest, docs, and seed data,
introducing no new architectural decision.

Gate green: `pnpm typecheck` (now incl. the SDK) clean; **111** API tests; web build clean;
`testing/phase9.sh` and `smoke_all.sh` **0–9** all green; dashboard populated and screenshot-ready.
**MemOS is done** — the full spec, built spec-first across ten test-gated phases, public on GitHub.

---

## 2026-06-23 — Phase 10: deployment (free-tier, hands-off)

Making the finished system *reachable*. A re-read of the runtime surface settled the shape: there's
**no build step** (everything runs under `tsx`), the live feed is **SSE** (so the API must be a
persistent process, not serverless), the demo needs **Postgres only** (the seed writes artifact
*rows*; MinIO/Redis aren't touched at boot), and there was **one real gap** — `server.ts` ignored
the platform-injected `PORT`. **ADR-008** records the topology: Neon (Postgres) + Render (API, free
Docker web service) + Vercel (dashboard) + GitHub Actions (CI + the scheduled critic), with the blob
store an optional add-on.

The image **self-provisions**: `infra/deploy/Dockerfile` does a `tsx`-only install (skipping the web
app's deps via `--filter=!@memos/web`), and `docker-entrypoint.sh` runs **migrate → seed → serve**,
both idempotent, so a fresh Neon DB comes up ready on first boot and every redeploy is safe.
`render.yaml` is a Blueprint with three `sync:false` secrets; `vercel.json` pins Next.js; the one
cross-service coupling is a shared `MEMOS_OPERATOR_TOKEN`. `ci.yml` green-gates every push (compose
stack → migrate → typecheck → API suite → web build); `critic.yml` runs the evidence critic on a
schedule against the prod DB. `docs/DEPLOY.md` is the ~10-minute click-by-click (the only manual
part: create three free accounts and paste secrets once).

`testing/phase10.sh` proves the deploy artifacts **locally, for free**: it builds the production
image, runs it against the compose Postgres on an injected `PORT=9099` (proving the port fix),
asserts the entrypoint self-migrated/seeded by smoke-testing `agent.me` + `objective.query` through
the container, re-runs it to prove redeploy idempotency, and lints the configs for env drift.

Gate green: `pnpm typecheck` clean; **111** API tests; web build clean; `testing/phase10.sh` green;
`smoke_all.sh` **0–10** all green. **MemOS is deployable** — one Blueprint click + a few pasted
secrets from a live URL.

---

## 2026-06-23 — Phase 11: multi-org tenancy foundation (v2 bedrock)

The start of v2 — turning a single-operator system into a multi-org product. The whole phase
turns on one ordering problem (**ADR-009**): auth must read identity to discover the org *before*
an org GUC can be set, so naively RLS-ing the control plane would deadlock the gateway out of its
own auth tables. Resolved by **denormalizing `org_id`** onto `agents`/`enrollment_codes`/`projects`
(+ the new `users`/`memberships`) so `resolveAgent` gets the org from a single by-token-hash row (no
more `teams` join), and `enroll` stamps it from the code row. A third request-local GUC,
`memos.org_id`, is set post-auth in `makeWithScope` alongside the project + identity GUCs.

**People are now first-class and org-bounded.** New `users` (scrypt-hashed passwords — a low-entropy
secret, unlike the 256-bit agent tokens that stay SHA-256) and `memberships` (`(user, scope_kind,
scope_id) → role`, role ∈ ceo|manager|member). `core/users.ts` adds `loginUser`/`resolveUserScope`/
`provisionOrg` (auth-bootstrap reads use the owner connection — they run before the org is known).
A user's read scope (CEO → all org projects; manager → team projects; member → project) feeds the
*same* `agent_projects` GUC, so one isolation mechanism serves agents and humans.

The DB-enforced isolation this phase: **`users` + `memberships` get FORCE RLS on the org GUC** —
org B can never read org A's people. Nothing reads those tables pre-GUC (login-by-email uses the
owner connection), so no auth deadlock. Structural-table (projects/teams) enumeration RLS is
deferred to the phase that introduces enumeration intents (13/14) — until then no cross-org
enumeration path exists, and forcing RLS there now would regress handler reads that use the
non-scoped path. `org_id` was added nullable, backfilled from team→org (all pre-migration data is
single-org), then set NOT NULL (migration 0008; drizzle-generated DDL + hand-authored backfill +
RLS, like 0002/0004/0007).

Gate green: `pnpm typecheck` clean (4 workspaces); **118** API tests (7 new — multi-org people
isolation + the unset-GUC default-deny + human auth/scope); `drizzle-kit generate` no-diff; web
build clean; `testing/phase11.sh` proves cross-org isolation over the wire under `memos_app`;
**`smoke_all.sh` 0–11 all green** — the agent loop + project isolation never regressed.

---

## 2026-06-24 — Phase 12: roles & authorization (autonomous)

Isolation answered "what can you see"; this adds "what may you do". **ADR-010**: a `role` on the
principal (member | manager | ceo, default member, inherited from the enrollment code; seeded
operator = manager) + a **central capability matrix** in `core/authz.ts` (two sets + a pure
`authorize(intent, role)`), enforced at the single dispatch choke point right after auth. Rules:
**CEO is read-only** (every write denied, even though it outranks for reads), **steering needs
manager** (objective.publish/update, brief.create, question.answer), everything else is member-level.
Chose one auditable matrix module over per-intent flags scattered across 23 registry entries — it's a
security surface, so it should be reviewable at a glance and unit-tested in isolation.

Migration 0009 adds `agents.role` + `enrollment_codes.role` (drizzle-gen DDL + a hand `UPDATE` to
elevate the demo operator). `resolveAgent` now returns `role`; `enroll` inherits it from the code.
The behavioral change rippled: agent-driven flows that steer (4 test suites + several phase scripts +
the SDK e2e) now need a `manager` code — updated accordingly (the role *restriction* is proven
separately, not by those functional scripts).

One self-inflicted snag, caught + fixed: the new authz test first named its agents `authz-*`, but
`cleanupAndClose` only deletes `vitest-%` agents — so it orphaned agents under the test team, its
team-delete FK'd, and every later suite's teardown then tripped on the orphans (an 18-suite cascade
from one mis-named fixture). Renamed to `vitest-authz-*`; clean.

Gate green: `pnpm typecheck` clean; **125** API tests (7 new — the role matrix, pure + through
dispatch); `drizzle-kit generate` no-diff; web build clean; `testing/phase12.sh` proves the
member/manager/ceo guard over HTTP; **`smoke_all.sh` 0–12 all green**.

---

## 2026-06-24 — Phase 13: per-user dashboard & user-principal auth (autonomous)

The dashboard becomes multi-user. **ADR-011**: humans authenticate with a **session bearer token**
that resolves to the *same* `AuthedAgent` principal shape as an agent — so the whole dispatch
pipeline (org/project GUC, the Phase-12 authz guard) is unchanged. New public **`user.login`** intent
verifies email+password (scrypt), mints a 256-bit token, stores its SHA-256 hash on
`users.session_token_hash` (migration 0010), and returns `{api_token, role, projects, …}`. Gateway
auth now tries `resolveAgent` then falls back to `resolveUserPrincipal` (users by token hash, owner
connection — a by-credential lookup before the org GUC exists). A user's effective role = highest
membership (ceo>manager>member); scope = `resolveUserScope.projects`.

Web: the signed httpOnly session cookie now carries the user token (not `operator:<ts>`); `callIntent`
+ the SSE proxy call the gateway AS that user (retiring the shared `MEMOS_OPERATOR_TOKEN` / ADR-007);
`getProjectId()` became async (selected-project cookie → else the user's first scope), so the pages
that read it now `await` it; a **ProjectSwitcher** lists the user's projects (a CEO's is the whole
org); login takes email+password; added sign-out. Seed adds an Acme manager + member user so all
three role-views are demoable; Playwright login helpers updated to email/password.

Gate green: `pnpm typecheck` (4 workspaces) clean; **130** API tests (5 new — login + user-principal
role gating through dispatch); `drizzle-kit generate` no-diff; web build clean; `testing/phase13.sh`
proves per-user login + scoping over HTTP; **`smoke_all.sh` 0–13 all green**.

---

## 2026-06-24 — Phase 14: self-serve admin & lifecycle (autonomous, v2 complete)

Onboarding stops needing SQL. **ADR-012**: five intents — public **`org.signup`** (creates an org +
starter team/project + first CEO, returns a session token), **`enrollment.create`** (mint an agent
code for a project in scope), **`user.invite`**, **`agent.revoke`**, **`member.offboard`** (disable
login + null the session). A new **`ADMIN_INTENTS`** tier in the authz matrix: org administration is
allowed for **manager OR ceo** and is *not* subject to the CEO read-only rule — the CEO runs the org
even though it can't author project content (otherwise a fresh org's only member could do nothing).
Every admin handler verifies the target belongs to the actor's org (no cross-org administration) and
writes an **`audit_log`** entry (migration 0011, org-RLS'd; written via the owner connection so the
public signup — which has no org GUC — still logs).

Two snags, both caught + fixed: `phase14.sh` first ran against a **stale gateway** left on :8787 from
manual testing (so the new intents 404'd) — killed it + re-ran fresh; and the script used **`UID`** as
a variable, which is a bash readonly builtin — renamed to `IUSERID`.

Gate green: `pnpm typecheck` (4 workspaces) clean; **134** API tests (4 new — the full signup → mint →
enroll → invite → offboard → revoke loop + audit assertions); `drizzle-kit generate` no-diff; web
build clean; `testing/phase14.sh` proves the zero-operator loop over HTTP; **`smoke_all.sh` 0–14 all
green**. **v2 is functionally complete** — a multi-org, role-based, self-serve agentic-supervision
product, all on free-tier, built across Phases 11–14 on branches for review.

---

## 2026-06-24 — Pre-merge verification of v2 (12–14): two gaps closed, one real bug fixed

Before signing off "safe to merge without manual review," ran the two checks the phase gates had
skipped. **(1) Fresh-from-scratch migration:** applied all 12 migrations + the seed to an *empty*
`memos_fresh` DB (the exact path the prod container takes on first boot) — clean apply, correct
structure (org-RLS on users/memberships/audit_log, project-RLS on facts/learnings, the v2 columns +
grants), and the seed provisioned a working 2-org / 4-user / 4-agent system. So the merge →
prod-auto-deploy migration path is de-risked.

**(2) Dashboard in a real browser (Playwright):** never actually run after the Phase-13 UI rewrite —
and it caught a **real Phase-13 regression**. User-principal auth was wired into the intent dispatch
but **not** into the SSE route `/v1/stream/activity` (it only ran `resolveAgent`), so a logged-in
human's live-activity feed 401'd — the feed was dead for every user. Fixed `app.ts` to fall back to
`resolveUserPrincipal` exactly like dispatch; verified directly (a CEO token now streams a posted
fact) and added `stream.test.ts` (the coverage hole that let it through — a user token on an
out-of-scope project must 403, not 401). The other e2e reds were harness/test issues, not product
bugs: the `Secure` session cookie (correct for HTTPS prod) can't round-trip on `http://localhost`, so
added a clearly-scoped **test-only** `COOKIE_INSECURE` opt-out (`lib/session.ts`) and pointed the
Playwright webServer at the *production build* (pre-compiled SSE) over it; the brief-authoring spec
logged in as the read-only CEO (it now uses the seeded manager); and parallel specs sharing
`ceo@acme.test` clobbered each other under the one-session-per-user model, so the suite runs
`workers: 1`. e2e now **3 passed / 1 skipped, deterministic**.

Re-gate after the fix: `pnpm typecheck` clean; **138** API tests green (+ the SSE regression);
`smoke_all.sh` 0–14 re-run green. The SSE fix lands on `phase-14-admin` (the cumulative branch).

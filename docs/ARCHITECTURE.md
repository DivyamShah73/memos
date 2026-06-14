# MemOS — Architecture (HLD)

> Copy to `docs/ARCHITECTURE.md` in the new repo. This is the high-level design: components, data flow, the request lifecycle, scaling, and the cross-cutting concerns. Keep it current as the build progresses — it's the doc an interviewer reads first.

---

## 1. One-paragraph summary

MemOS is a **shared organizational memory layer for AI coding agents**, exposed as a single intent-RPC HTTP endpoint over Postgres + a blob store. Agents authenticate with opaque bearer tokens and, on every task, run an *operating loop*: fetch operator briefs + OKRs, open a workflow run bound to a goal, do work, and publish **evidence-gated facts and learnings** that any other agent in the org can later query. A human operator steers the fleet through briefs and OKRs via a Next.js dashboard. Background "critic" workers audit the store and keep it clean. The whole thing is multi-tenant (org → team → project) with isolation enforced at the database via Row-Level Security.

---

## 2. Component diagram (HLD)

```
                         ┌──────────────────────────────────────────────┐
   AI AGENTS             │                 MemOS                          │
  (Claude Code,          │                                                │
   Cursor, CI bots)      │   ┌────────────────────────────────────────┐  │
        │                │   │  Intent Gateway (Hono, stateless)       │  │
        │  POST          │   │  POST /v1/intent/{name}                 │  │
        │  /v1/intent/*  │   │  ─────────────────────────────────────  │  │
        ├───────────────►│   │  [1] auth (bearer → agent + scopes)     │  │
        │  Bearer syn_   │   │  [2] rate-limit (per-token)             │  │
        │◄───────────────┤   │  [3] zod validate → 400 field_errors    │  │
        │  {ok,data,...}  │   │  [4] set RLS context (agent_projects)   │  │
        │                │   │  [5] dispatch → intent handler          │  │
        │                │   │  [6] uniform envelope + audit log       │  │
        │                │   └───────────────┬────────────────────────┘  │
        │                │                   │                            │
        │                │      ┌────────────┼─────────────┐             │
        │                │      ▼            ▼             ▼              │
        │                │  ┌────────┐  ┌─────────┐  ┌──────────┐        │
        │                │  │Postgres│  │  Blob    │  │  Queue    │        │
        │                │  │+pgvector│ │ (S3/MinIO)│ │(BullMQ/   │        │
        │                │  │  +RLS   │  │ artifacts│ │ pg-boss)  │        │
        │                │  └────┬───┘  └─────────┘  └────┬─────┘        │
        │                │       │                        │              │
        │                │       │              ┌─────────▼──────────┐    │
        │                │       │              │  Async Workers      │    │
        │                │       │              │  • evidence critic  │    │
        │                │       │              │  • tag-hygiene critic│   │
        │                │       │              │  • loop-close critic │   │
        │                │       │              │  • DOK grader        │   │
        │                │       │              │  • brief escalation  │   │
        │                │       │              │  • embed-on-write     │   │
        │                │       │              └─────────┬──────────┘    │
        │                │       │                        │ (file briefs) │
        │                │       │◄───────────────────────┘              │
        │                └───────┼────────────────────────────────────────┘
                                 │
   OPERATORS (humans) ──────────►│  Next.js dashboard (App Router)
   login via Supabase Auth       │  • OKR tree + rollups   • live activity feed (Realtime/SSE)
                                  │  • provenance graph     • brief authoring
                                  │  • token/member mgmt    • trust leaderboard
                                  └─ reads Postgres (RLS) + subscribes to Realtime
```

---

## 3. Why these shapes (the load-bearing decisions)

| Decision | Rationale | ADR |
|---|---|---|
| **Single intent-RPC endpoint** (not REST resources) | One choke point for auth/validation/rate-limit/trust/audit; the whole API is legible to an LLM from one manifest; uniform envelope makes agent error-handling mechanical. | `001-intent-rpc.md` |
| **RLS at the DB** (not handler-only) | Isolation is a security boundary; a bug in one handler must not leak another tenant's data. The gateway sets a per-request `memos.agent_projects` setting; policies enforce it. | `002-rls-multitenancy.md` |
| **Evidence-gated writes** | The product's value is a *clean* store. Medium/high facts & learnings require an uploaded artifact; learnings also require a non-obvious marker. Enforced in schema + handler + test. | `003-evidence-gate.md` |
| **Fact vs Learning split** | Different lifecycles: facts are point-in-time, project-scoped observations; learnings are reusable, cross-silo insights with quality grading and a reuse feedback loop. | `004-fact-learning-split.md` |
| **Stateless gateway + async workers** | Gateway scales horizontally; slow/periodic governance (critics, grading, embeddings) runs off the request path. | `005-async-governance.md` |
| **Blob store for artifacts** | Bytes never live in Postgres; DB holds `bucket_path` + `sha256` + metadata. Keeps rows small and the DB fast. | — |

---

## 4. Request lifecycle (trace one write)

`fact.record` with a medium-confidence claim:

1. **Ingress.** `POST /v1/intent/fact.record`, `Authorization: Bearer syn_…`.
2. **Auth.** Token hashed, looked up → resolves `agent` + `scopes` (its projects). 401 if unknown/revoked.
3. **Rate-limit.** Per-token bucket. 429 + `Retry-After` if exceeded.
4. **Validate.** Zod schema for `fact.record`. The `superRefine` rejects a medium/high claim with no `evidence_artifact_id` → **400** with `detail.field_errors`.
5. **RLS context.** Gateway calls `set_config('memos.agent_projects', <agent's projects>, true)` on the connection.
6. **Handler.**
   - Verifies the cited `evidence_artifact_id` exists **and** is same-tenant/same-`bd_id` (no borrowing another project's evidence).
   - Verifies the `bd_id` workflow run exists and belongs to the agent's project.
   - Inserts the fact. RLS double-checks the `project_id` is in scope.
   - Enqueues an `embed-on-write` job (compute + store the claim embedding for semantic query).
7. **Envelope.** Returns `{ ok: true, data: { fact_ids: […] } }`. Writes an audit-log row.
8. **Async.** Worker computes the embedding; later, the DOK grader and evidence critic may touch this row on their next sweep.

A **read** (`learning.query`) is the same path up to step 5, then: embed the query string → pgvector cosine search within the agent's scope (RLS-filtered) → optional keyword/FTS fallback → ranked `learnings[]`.

---

## 5. The two governance loops (what keeps it clean)

**Inline (synchronous), on the request path:** the evidence gate, non-obvious gate, provenance-FK checks, and RLS. These *reject* bad writes immediately.

**Async (scheduled), off the request path — the critic workers:**
- **Evidence-compliance critic** — scans recent learnings for medium/high confidence lacking evidence; files a brief at offenders.
- **Tag-hygiene critic** — flags `applies_to` tags that are project/product names instead of problem-domain terms.
- **Loop-close critic** — flags `choices` open too long with no outcome, and workflow runs with no closing checkin.
- **DOK grader** — grades learnings DOK1–4; demotes those missing `non_obvious_marker` + evidence out of cross-silo discovery.
- **Brief-escalation sweep** — briefs unacked > 24h escalate; chronic ignoring lowers trust → token revocation.

Critics are themselves MemOS clients (the platform dogfoods itself).

---

## 6. Trust & quality model

- **Agent trust score (0–1):** rises with compliance (acked briefs, closed runs, evidence-backed writes), falls with violations. Low trust → token revoked. Surfaced on the dashboard leaderboard.
- **Learning DOK grade (DOK1–4) + reuse counters:** `reuse_count` / `reuse_success_count` increment when another agent applies a learning and reports the outcome. High-reuse-success learnings are the org's compounding capital and rank highest in query results.

---

## 7. Scaling story (have this ready for interviews)

- **Gateway:** stateless → horizontal scale behind a load balancer. No sticky sessions.
- **Postgres:** read replicas for the dashboard + `*.query` reads; primary for writes. Partition `facts`/`learnings`/`checkins` by `created_at` when they grow.
- **pgvector:** HNSW index for recall at scale; cap embedding dimensions; batch embed jobs to control cost. Cache hot query embeddings.
- **Queue backpressure:** critics and embedding jobs are idempotent and retryable; a backlog degrades freshness, never correctness.
- **Rate limiting:** per-token + per-project ceilings stop one runaway agent from starving others.
- **Blob store:** offload artifact bytes entirely; serve via signed URLs; lifecycle-expire old artifacts.
- **Embedding cost control:** only embed `claim` text (short), dedupe identical claims, and skip re-embedding on no-op updates.
- **Cost ceiling on writes:** the evidence gate also naturally rate-limits junk — agents can't spam unbacked claims.

---

## 8. Security & isolation

- Tokens stored **hashed**; raw `syn_…` shown once at enrollment. Single-use enrollment codes.
- **RLS is the isolation boundary**, not handler code. Every tenant-scoped table has policies keyed on the per-request `memos.agent_projects` setting.
- Cross-silo *learning* discovery is a deliberate, curated read path (problem-domain tags) — **facts stay project-scoped**. Any unscoped query is privileged and audited.
- All mutations write an audit-log row (who/what/when/bd_id).
- Operator auth via Supabase Auth; dashboard reads are RLS-filtered too.

---

## 9. Tech stack (at a glance)

TypeScript everywhere · Hono (gateway) · Zod (validation) · Drizzle ORM · Postgres + pgvector (Supabase; docker locally) · MinIO/S3 (artifacts) · BullMQ+Redis or pg-boss (async) · Next.js 15 App Router + Tailwind + shadcn/ui + Framer Motion (web) · Recharts + React Flow (viz) · Supabase Realtime/SSE (live feed) · Vitest + Playwright (tests) · GitHub Actions (CI).

See `docs/DATA_MODEL.md` for the LLD (schema, indexes, RLS policies, ER diagram) and `docs/decisions/` for the ADRs referenced above.

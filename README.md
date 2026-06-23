# MemOS

**A shared organizational memory layer for AI coding agents.**

In an org running many AI agents (Claude Code sessions, Cursor agents, CI bots), each agent is an island — an insight one agent discovers dies in its session and never helps the next. **MemOS** gives every agent a shared, queryable, persistent memory scoped by **org → team → project**. Agents publish verified **facts** and reusable **learnings** as they work, and query the shared store before re-deriving anything. A human operator steers the fleet through **briefs** (standing instructions) and **OKRs** (goals agents bind their work to), and watches it all on a live dashboard.

The design insight that keeps the store trustworthy rather than a junk drawer: **every write is evidence-gated.** A medium/high-confidence claim must cite uploaded evidence; a reusable learning must also be marked non-obvious with a reason. The gate is enforced in the schema *and* the handler, and an autonomous critic polices anything that slips through.

![Operator console — OKR tree + live activity feed](docs/screenshots/console.png)

---

## Architecture

```mermaid
flowchart LR
  subgraph Fleet["AI coding agents"]
    A1[agent] --- A2[agent] --- A3[agent]
  end
  Op([Operator]) --> Dash["Next.js dashboard<br/>OKR tree · live feed · provenance graph"]
  Fleet -->|"@memos/agent SDK → intents"| GW
  Dash -->|"operator token (server-side)"| GW
  GW["Intent-RPC gateway (Hono)<br/>one endpoint · Zod · token auth · RLS scope"]
  GW -->|"per-request GUC, FORCE RLS"| PG[("PostgreSQL + pgvector<br/>facts · learnings · OKRs · briefs · provenance")]
  GW -->|"evidence blobs"| S3[("MinIO / S3")]
  GW -->|"post-commit publish"| BUS(["in-process event bus"])
  BUS -->|SSE| Dash
  WK["Governance workers<br/>evidence critic · 24h escalation"] -->|owner, all tenants| PG
```

- **One choke point.** The entire API is `POST /v1/intent/{name}` (ADR-001): a single pipeline does auth → validation → handler → uniform envelope, so every intent gets the same guarantees.
- **Isolation at the database, not in handlers.** Multi-tenancy is enforced by Postgres **Row-Level Security** under a least-privilege role, with a per-request transaction-scoped GUC (ADR-002/004); briefs add a second identity GUC (ADR-006). A query in project A *cannot* return project B's rows — proven by tests, not convention.
- **A provenance spine.** Every fact/learning/artifact/checkin threads onto a workflow run (`bd_id`); the run binds to an OKR. The dashboard's provenance graph walks that spine: *learning → evidence artifact → run → OKR → agent.*

## The core invariants (the product)

| Invariant | What it means |
|---|---|
| **Evidence gate** | A fact/learning at `confidence ≥ medium` must carry an `evidence_artifact_id` (same project + run). Enforced in Zod **and** the handler. |
| **Non-obvious gate** | A medium/high learning must also carry a `non_obvious_marker` (≥ 15 chars). |
| **Tenant isolation** | Org/team/project isolation via RLS — never a handler `WHERE` clause alone. |
| **Provenance thread** | Nothing is orphaned: every artifact/fact/learning/checkin attaches to a `bd_id`; runs bind to objectives. |
| **Problem-domain tags** | `applies_to` tags are domains (`vllm-deployment`), never product names — so a learning surfaces across silos. |

## How an agent uses it

`enroll → fetch briefs → open a workflow → query before deriving → upload evidence → record evidence-gated facts/learnings → move OKRs → close.` See **[`AGENTS.md`](AGENTS.md)** and the **[`@memos/agent`](sdk/memos-agent)** SDK.

```ts
import { MemosClient } from "@memos/agent";
const { client } = await MemosClient.enroll("http://127.0.0.1:8787", code, "my-agent");
const { bd_id } = await client.workflowCreate({ project_id, workflow_class: "investigation", title });
const art = await client.artifactUpload({ project_id, bd_id, kind: "log", mime_type: "text/plain", content_base64 });
await client.factRecord({ project_id, bd_id, facts: [{ claim: "p99 dropped to 180ms", confidence: "medium", evidence_artifact_id: art.artifact_id }] });
const { facts } = await client.factQuery({ project_id, query: "latency" }); // reuse beats rework
```

## Dashboard

| Provenance graph | Trust leaderboard | Brief authoring |
|---|---|---|
| ![provenance](docs/screenshots/provenance.png) | ![leaderboard](docs/screenshots/leaderboard.png) | ![briefs](docs/screenshots/briefs.png) |

The **OKR tree** shows weighted rollups; the **activity feed** updates in real time (SSE) as agents write; the **provenance graph** (React Flow) lights up a learning's full lineage; the **leaderboard** ranks agents by trust; **briefs** let the operator publish a standing instruction that reaches an agent.

## Tech stack

TypeScript end-to-end · **Hono** (intent-RPC gateway) · **Zod** · **Drizzle ORM** · **Postgres + pgvector** (keyword FTS today; pgvector-ready for embeddings) · **MinIO/S3** (evidence) · async governance workers · **Next.js 15** + Tailwind + **React Flow** (dashboard) · **Vitest + Playwright**.

## Getting started

```bash
pnpm install
docker compose up -d            # postgres + minio + redis
pnpm db:migrate
pnpm db:seed                    # demo org/agents/OKRs/briefs/activity
pnpm --filter @memos/api dev    # gateway → http://127.0.0.1:8787
pnpm --filter @memos/web dev    # dashboard → http://localhost:3000  (login: memos)
```

Verify the whole system from a clean DB:

```bash
pnpm test                       # ~111 Vitest cases (invariants + every intent)
bash testing/smoke_all.sh       # phases 0–9 end-to-end over HTTP, incl. the SDK loop
```

## How it's built

Spec-first and **test-gated, phase by phase** (`docs/PHASED_BUILD_PLAN.md`): each phase ships code + colocated tests + an exit gate that must pass before the next. Architectural choices are recorded as **[ADRs](docs/decisions/)** (intent-RPC, RLS isolation, token auth, request scoping, OKR rollups, briefs identity-RLS, dashboard-via-gateway/SSE). Build log in `docs/JOURNAL.md`. The SDK-driven end-to-end test (`testing/phase9.sh`) proves the full loop plus the evidence gate, tenant isolation, and UTF-8 (`≤ — 🎯`) round-trip.

## Documentation

| Doc | What |
|---|---|
| [`AGENTS.md`](AGENTS.md) | How an AI agent uses MemOS (the loop + the gates) |
| [`docs/API.md`](docs/API.md) | Every intent: input, output, semantics |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | HLD / LLD |
| [`docs/decisions/`](docs/decisions/) | Architecture Decision Records |
| [`docs/PHASED_BUILD_PLAN.md`](docs/PHASED_BUILD_PLAN.md) · [`docs/JOURNAL.md`](docs/JOURNAL.md) | The build plan + log |

## License

Private — all rights reserved.

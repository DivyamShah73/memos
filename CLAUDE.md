# MemOS — Claude Code Project Instructions

> Copy this file to the root of your new `memos/` repo as `CLAUDE.md`. It is read at the start of every session and steers all agent work. Edit the bracketed bits as the project takes shape.

## What this project is

MemOS is a **shared organizational memory layer for AI coding agents**. Multiple agents across an org's teams/projects publish verified facts and reusable learnings as they work, and query the shared store before re-deriving anything. A human operator steers the fleet via briefs (standing instructions) and OKRs (goals).

The complete specification is in `docs/PROJECT_DOC.md`. **Read it before any non-trivial task.** The architecture is in `docs/ARCHITECTURE.md`, the data model in `docs/DATA_MODEL.md`.

## Core invariants (NEVER violate — these are the product)

1. **Evidence gate.** Any fact or learning at `confidence >= medium` MUST carry an `evidence_artifact_id`. Enforce this in BOTH the Zod schema and the handler, and cover it with a test. A medium/high write without evidence must be rejected.
2. **Non-obvious gate.** A learning at `confidence >= medium` MUST also carry a `non_obvious_marker` (>=15 chars). Reject otherwise.
3. **Multi-tenancy isolation.** Every entity carries `project_id`/`team_id`. Isolation is enforced at the DB via Row-Level Security, not just in handlers. No query may return another tenant's facts. When you touch a query, ask: "can this leak across projects?"
4. **Provenance thread.** Every fact, learning, artifact, and checkin attaches to a workflow run via `bd_id`. A workflow run binds to an OKR via `target_objective_id`. Never break this chain.
5. **`applies_to` tags are problem-domain terms** (`fine-tuning`, `vllm-deployment`), never project/product names. This is what lets a learning surface across silos.

## Working agreement (how we build)

- **Plan first.** For any non-trivial task, enter plan mode, show me the plan, and wait for approval before writing code. I am the architect/reviewer; you are the builder.
- **One intent, one file.** Each API intent handler lives in `packages/api/src/intents/<name>.ts` with a colocated test.
- **Schema-as-code.** All DB changes go through Drizzle migrations in `infra/migrations/`. Never hand-edit the DB.
- **Test the invariants.** Every change that touches a core invariant (above) needs a test proving it holds.
- **ADRs for decisions.** When we make a real architectural choice, write `docs/decisions/NNN-title.md` (context, decision, consequences). Use the `write-adr` skill.
- **Journal.** After each session, append a short paragraph to `docs/JOURNAL.md`: what was built and why.
- **Conventional commits**, small and focused. Commit each logical chunk as we go; don't batch.

## Tech stack (locked — do not re-litigate)

TypeScript everywhere. Hono (API) · Zod (validation) · Drizzle ORM · Postgres + pgvector (Supabase; docker locally) · MinIO/S3 (blobs) · BullMQ+Redis or pg-boss (async) · Next.js 15 App Router + Tailwind + shadcn/ui (web) · Recharts + React Flow (viz) · Vitest + Playwright (tests).

## Commands

```bash
pnpm install            # install all workspaces
docker compose up -d    # local postgres + minio + redis
pnpm db:migrate         # apply Drizzle migrations
pnpm db:seed            # demo seed data
pnpm --filter api dev   # run the gateway
pnpm --filter web dev   # run the dashboard
pnpm test               # vitest across packages
pnpm test:e2e           # playwright
pnpm lint && pnpm typecheck
```

## Conventions

- Response envelope is uniform: `{ ok: true, data }` or `{ ok: false, error, detail, error_type }`. Every handler returns it. Never throw raw to the client.
- IDs: projects `project.<slug>`, teams `team.<slug>`, agents `agent.<slug>`, workflow runs `synapse-<short>` (or `memos-<short>`), everything else UUID.
- Store tokens **hashed**; show the raw `syn_...` exactly once on enroll.
- All text is UTF-8 clean end-to-end. Test that `≤`, `—`, emoji round-trip correctly (the system we're modeling got this wrong — we won't).
- Errors: 400 = schema (return `detail.field_errors`), 200 `ok:false` = business rule, 401 = bad token, 403 = scope, 429 = rate limit, 5xx = platform.

## Definition of done (per feature)

Code + colocated test + invariant covered + docs updated (`API.md` for new intents) + `/code-review` clean + demo for the current day's milestone still passes.

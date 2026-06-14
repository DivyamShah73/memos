# MemOS

**A shared organizational memory layer for AI coding agents.**

In an org running many AI agents (Claude Code sessions, Cursor agents, CI bots), each agent is an island — an insight one agent discovers dies in its session and never helps the next. MemOS gives every agent a shared, queryable, persistent memory scoped by **org → team → project**. Agents automatically publish verified **facts** and reusable **learnings** as they work, and query the shared store before re-deriving anything. A human operator steers the fleet through **briefs** (standing instructions) and **OKRs** (goals agents bind their work to).

The design insight that keeps the store trustworthy rather than a junk drawer: **every write is evidence-gated and quality-graded.** A confident claim must carry uploaded evidence; a reusable learning must be marked non-obvious with a reason.

---

## Status

🚧 Early build. Specification and architecture are complete; implementation is phased — see `docs/PHASED_BUILD_PLAN.md`.

## Tech stack

TypeScript end-to-end · Hono (intent-RPC gateway) · Zod · Drizzle ORM · Postgres + pgvector (Supabase) · MinIO/S3 (artifacts) · BullMQ/pg-boss (async workers) · Next.js 15 + Tailwind + shadcn/ui + React Flow (dashboard) · Vitest + Playwright.

## Repo layout

```
packages/
  api/        intent-RPC gateway (backend)
  workers/    async critics, DOK grader, escalation sweeps
  web/        Next.js operator dashboard
  shared/     types + Zod schemas shared by api + web
infra/        docker-compose (postgres + minio + redis), migrations
sdk/          agent client library + manifest
docs/         spec, architecture (HLD), data model (LLD), concepts, phased plan, ADRs
testing/      per-phase manual test scripts + smoke suite
```

## Documentation

| Doc | What |
|---|---|
| `docs/PROJECT_DOC.md` | Full spec: problem, architecture, data model, every API intent, the operating loops |
| `docs/ARCHITECTURE.md` | High-level design — components, request lifecycle, governance loops, scaling |
| `docs/DATA_MODEL.md` | Low-level design — ER diagram, tables, indexes, RLS policies, queries |
| `docs/CONCEPTS_EXPLAINED.md` | Plain-English explanation of every concept used in the project |
| `docs/PHASED_BUILD_PLAN.md` | Test-gated phase plan — each phase has automated + manual tests and an exit gate |
| `docs/SETUP_GUIDE.md` | Build setup, conventions, and how the agentic workflow runs |
| `docs/decisions/` | Architecture Decision Records |

## Getting started

```bash
pnpm install
docker compose up -d        # postgres + minio + redis
pnpm db:migrate
pnpm --filter api dev       # gateway
pnpm --filter web dev       # dashboard
pnpm test                   # vitest
```

## License

Private — all rights reserved.

# MemOS — Agentic Build Setup (3–4 day plan)

> How to vibe-code the entire MemOS project with Claude Code while you observe — and come out the other side **understanding every piece**. This is the master guide. Read it top to bottom once, then follow the day plan.

Rahul built Synapse in a weekend. You can match that *and* understand it, because you have the reverse-engineered spec (`PROJECT_DOC.md`) he didn't have when he started. Your advantage is clarity of target. Your job is to be a sharp **observer + reviewer**, not a typist.

---

## 0. The philosophy of "vibe coding as an observer"

You are the **architect and reviewer**; Claude Code is the **builder**. To make this produce a portfolio piece that proves *you* have the skills (not just that Claude does), you must do four things at every step:

1. **Plan before code.** Every feature starts in plan mode. You read the plan, you approve it. This is where your system-design judgment shows.
2. **Review every PR.** Use the `/code-review` and `/security-review` skills. You'll catch things and learn the codebase by reading it.
3. **Demand explanations.** After each phase, have Claude write a short `docs/decisions/NNN-*.md` (an ADR — Architecture Decision Record). This is your understanding made durable, and it's *gold* in interviews.
4. **Keep a learning journal.** `docs/JOURNAL.md` — one paragraph per session on what was built and why. You'll thank yourself.

The deliverable isn't just working software. It's working software **plus** a decision trail that proves you drove it.

---

## 1. Repo structure (set this up first)

Use a **monorepo**. It shows you can reason about a full system, and keeps the demo one-clone-away.

```
memos/
├── README.md                      # the showcase front-door (write this LAST, make it great)
├── CLAUDE.md                      # agent instructions (from templates/CLAUDE.md)
├── docs/
│   ├── PROJECT_DOC.md             # the spec (copy from this kit)
│   ├── ARCHITECTURE.md            # HLD: diagrams, data flow, tech choices
│   ├── DATA_MODEL.md              # LLD: ER diagram, every table, indexes
│   ├── API.md                     # every intent, request/response examples
│   ├── JOURNAL.md                 # your running build journal
│   └── decisions/                 # ADRs: 001-why-intent-rpc.md, 002-rls-strategy.md, ...
├── packages/
│   ├── api/                       # the intent gateway (backend)
│   │   ├── src/
│   │   │   ├── intents/           # one file per intent handler
│   │   │   ├── core/              # envelope, auth, rate-limit, trust-scoring
│   │   │   ├── db/                # schema, migrations, queries
│   │   │   ├── services/          # blob store, embeddings, critics
│   │   │   └── server.ts
│   │   └── test/
│   ├── workers/                   # async: critics, DOK grader, escalation sweeps
│   ├── web/                       # Next.js operator dashboard (frontend)
│   └── shared/                    # types + Zod schemas shared by api + web
├── infra/
│   ├── docker-compose.yml         # local postgres + minio (S3) for dev
│   └── migrations/                # SQL migrations
├── sdk/
│   └── memos-agent/               # the agent client lib + manifest (agents.md)
└── .github/workflows/             # CI: typecheck, test, lint
```

**Why this layout proves skill:**
- `packages/` monorepo → you understand module boundaries.
- `sdk/` → you built a *client*, not just a server. Shows API empathy.
- `docs/decisions/` → ADRs are a senior-engineer signal.
- `infra/` with docker-compose → you can stand up dependencies reproducibly.

---

## 2. Tech stack (locked choices — don't re-litigate mid-build)

Decide once, now, so you don't burn a day waffling. These maximize the "shows advanced skill" goal while staying buildable in days.

| Concern | Choice | What it demonstrates |
|---|---|---|
| **Language** | TypeScript end-to-end | One language, full-stack fluency; shared types api↔web |
| **API framework** | **Hono** (fast, edge-ready, tiny) | Modern backend, not boilerplate Express |
| **Validation** | **Zod** | Type-safe contracts; field-error mapping |
| **DB** | **Postgres** via **Supabase** (local docker for dev) | Relational modeling, RLS, the real deal |
| **Query layer** | **Drizzle ORM** | Schema-as-code, migrations, type-safe SQL |
| **Vector search** | **pgvector** | AI system design signal |
| **Embeddings** | OpenAI `text-embedding-3-small` (or local `bge-small`) | Semantic recall |
| **Blob store** | **MinIO** local / Supabase Storage prod | Object storage, not bytes-in-DB |
| **Async** | **BullMQ** + Redis (or pg-boss if you want zero extra infra) | Job queues, scheduled workers |
| **Frontend** | **Next.js 15 (App Router)** + **Tailwind** + **shadcn/ui** | Modern, beautiful, fast |
| **Data viz** | **Recharts** or **visx** (OKR rollups), **React Flow** (provenance graph) | The "extraordinary UI" piece |
| **Realtime** | Supabase Realtime or SSE | Live activity feed = demo wow-factor |
| **Auth (human)** | Supabase Auth | OAuth/email, RLS integration |
| **Tests** | **Vitest** + **Playwright** (e2e) | You test your work |
| **CI** | GitHub Actions | Engineering hygiene |

> If you want to show **polyglot** range instead, build `packages/api` in Python/FastAPI. But TS end-to-end is faster to vibe-code and the shared-types story is stronger. Recommendation: **TS**.

---

## 3. The agentic setup (this is the multiplier)

Speed in days comes from a tight agent harness, not from typing fast. Set up these five things before you write any feature code.

### 3.1 `CLAUDE.md` at repo root
Copy `templates/CLAUDE.md` from this kit. It tells Claude the architecture, the conventions, the test commands, the "always plan first" rule, and the ADR rule. **This file is your steering wheel.** Every session reads it.

### 3.2 Project skills (the big lever)
Skills are reusable, invocable playbooks. This kit ships **7 custom skills** in `skills/` — copy them to `.claude/skills/` in your new repo. They encode the repetitive, high-skill workflows so you get consistent output every time:
- `scaffold-intent` — add a new intent end-to-end (schema → handler → test → docs) the same way every time
- `db-migration` — write a Drizzle migration + RLS policy correctly
- `design-review` — HLD/LLD review of a plan before coding
- `frontend-component` — build a dashboard component to your design system
- `write-adr` — capture an architecture decision
- `evidence-gate-check` — verify the core write-gating invariants are enforced
- `demo-seed` — generate realistic seed data for screenshots/demos

### 3.3 Settings & permissions
Copy `templates/settings.json`. It pre-allows the safe, repetitive commands (npm/pnpm, drizzle, vitest, git status/diff) so you're not approving every call — but keeps destructive ops gated. This is the difference between a smooth 3-day build and approval fatigue.

### 3.4 Plan-mode discipline
Run Claude in a mode where **non-trivial work enters plan mode first**. You review the plan, approve, then it builds. You stay the architect. (The `design-review` skill formalizes this for big features.)

### 3.5 Sub-agents for parallel work
Use the `Agent` tool to fan out independent work — e.g. "build the 6 read-intents" as parallel sub-agents while you review the write-path. The monorepo's clean boundaries make this safe.

---

## 4. The 3–4 day plan

Each day ends with something demoable. **Do not** start a day before the previous day's demo works.

### Day 0 (evening before — 1–2 hrs): Foundation
- New repo, monorepo skeleton (§1), `CLAUDE.md`, skills, settings copied in.
- `docker-compose up` → Postgres + MinIO running locally.
- Drizzle schema for the full data model (PROJECT_DOC §3). Migration applies clean.
- `/write-adr` for: "Why intent-RPC over REST" and "RLS multi-tenancy strategy."
- **Demo:** `pnpm db:migrate` succeeds; you can see all tables.

### Day 1: Backend core (the write path)
- Intent gateway: single route, envelope, Zod per-intent schemas, bearer auth middleware.
- `agent.enroll` (code→token), token hashing.
- `workflow.create`, `checkin`, `artifact.upload` (→ MinIO).
- `fact.record` / `learning.record` with **evidence gate + non-obvious gate enforced**.
- `fact.query` / `learning.query` (Postgres FTS first).
- Vitest covering the gates (the invariant tests are your correctness story).
- **Demo:** a curl script runs the full agent loop; an evidence-less medium write is rejected.

### Day 2: Goals, briefs, governance
- `objective.publish/query/update`, `milestone.achieve`, `key_result.update`, rollup math.
- `brief.fetch` (+ `active_okrs`), `brief.ack`, supersede chain, 24h escalation sweep.
- `question.ask/answer` (answer → brief delivery).
- pgvector semantic query; embed claims on write.
- One **critic worker** (evidence-compliance) + DOK grader stub.
- **Demo:** OKR rollups move; a critic files a brief at a non-compliant write.

### Day 3: The dashboard (the showpiece)
- Next.js + shadcn. Operator login (Supabase Auth).
- **OKR tree** with live rollup bars (Recharts).
- **Live activity feed** (Realtime/SSE) — checkins/facts/learnings streaming in.
- **Provenance graph** (React Flow): learning → artifact → run → OKR → agent. This is the screenshot that gets you hired.
- Brief authoring, member/token management, agent trust leaderboard.
- **Demo:** end-to-end — agent writes via SDK, dashboard updates live.

### Day 4 (buffer + polish): Make it portfolio-grade
- `sdk/memos-agent` client lib + `agents.md` manifest served at `/agents.md`.
- `/demo-seed` to populate a rich, screenshot-ready dataset.
- README with architecture diagram, GIF of the live feed, "how it works" section.
- Deploy (Fly.io + Supabase cloud). Public demo URL.
- Record a 2-minute Loom walking the architecture. (Interview ammunition.)

---

## 5. How to show each of your four target skills

Be deliberate — make each skill *visible* in the artifact.

**1. Advanced backend**
- The intent gateway with one validation/auth/rate-limit/trust choke point.
- Evidence-gated writes enforced at the DB + handler.
- pgvector semantic search with embedding-on-write.
- Idempotency keys on writes; optimistic concurrency on OKR updates.
- → Document these in `docs/ARCHITECTURE.md` with the *why*.

**2. AI system design**
- The fact/learning split + DOK grading + reuse-feedback loop.
- Critic agents that govern the store (the platform dogfoods itself).
- The agent operating-loop contract and the manifest.
- → A dedicated `docs/AI_SYSTEM_DESIGN.md` section: how knowledge compounds and stays clean.

**3. Extraordinary UI**
- Live activity feed (realtime).
- Provenance graph (React Flow) — visually striking and conceptually deep.
- OKR rollup tree with animated progress.
- Polished empty states, dark mode, micro-interactions. Use shadcn + Framer Motion.
- → Screenshots + a Loom in the README.

**4. System design (LLD + HLD)**
- `docs/ARCHITECTURE.md` (HLD): component diagram, data flow, scaling story, multi-tenancy.
- `docs/DATA_MODEL.md` (LLD): ER diagram, indexes, RLS policies, the provenance graph schema.
- ADRs in `docs/decisions/`.
- A "scaling MemOS to 10k agents" section (rate limiting, read replicas, queue backpressure, embedding cost control).

---

## 6. Reviewer checklist (run this every session — your quality bar)

- [ ] Did the feature start in plan mode and did I read the plan?
- [ ] Is there a test for the core invariant this change touches?
- [ ] `/code-review` run on the diff?
- [ ] Multi-tenancy: can this leak across projects? (RLS check)
- [ ] Is there an ADR if this was a real decision?
- [ ] JOURNAL.md updated?
- [ ] Does the demo for today's milestone still pass?

---

## 7. First three prompts to give Claude in the new repo

1. *"Read `docs/PROJECT_DOC.md` and `CLAUDE.md`. Then enter plan mode and propose the monorepo scaffold and the Drizzle schema for the full data model. Don't write code yet — show me the plan and the schema."*
2. *(after approving)* *"Build the scaffold and schema. Then write `docs/decisions/001-intent-rpc.md` and `002-rls-multitenancy.md` explaining the choices."*
3. *"Now use the `scaffold-intent` skill to build `workflow.create` and `checkin` end-to-end with tests."*

From there, work the day plan. Stay the observer. Review everything. Keep the journal.

---

*Companion files in this kit: `PROJECT_DOC.md` (the full spec), `templates/CLAUDE.md`, `templates/settings.json`, and `skills/*.md` (7 skills). Copy them into your new repo's root, `.claude/`, and `.claude/skills/`.*

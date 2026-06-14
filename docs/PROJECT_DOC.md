# Org Memory OS — Project Build Doc

> A reverse-engineered, build-ready specification for a Synapse-OS-style **shared organizational memory layer for AI coding agents**. This is the complete blueprint: problem, architecture, data model, full API, the behavioral "loops" that make it work, the agent-integration contract, and a phased build plan. You can lift this into a fresh repo and build the entire project from it.
>
> Working name used throughout: **MemOS**. Rename freely.

---

## 0. The Problem (why this exists)

In any org running many AI coding agents (Claude Code sessions, Cursor agents, CI bots), **each agent is an island**. Agent A spends two hours discovering that "DataCrunch GPU instances block port 8000 at the host firewall." Agent B, on a different project next week, hits the identical wall and burns the same two hours. The insight died inside A's session transcript.

The waste compounds across three dimensions:
1. **Insights aren't shared** — a hard-won finding helps only the session that found it.
2. **Work isn't coordinated** — two agents redo the same investigation, or worse, make conflicting changes.
3. **There's no institutional memory** — when a session ends, everything it learned evaporates.

**MemOS solves this by giving every agent a shared, queryable, persistent memory, scoped by org → team → project.** Agents automatically *publish* verified facts and reusable learnings as they work, and *query* the shared store before re-deriving anything. A human operator steers the fleet through "briefs" (standing instructions) and OKRs (goals agents bind their work to).

The core design insight that makes it actually work (and not become a junk drawer): **every write is evidence-gated and quality-graded.** An agent can't dump unverified noise — a medium/high-confidence claim must carry an uploaded evidence artifact, and reusable learnings must be marked *non-obvious* with a reason. This keeps the signal-to-noise ratio high enough that querying the store is worth it.

---

## 1. Mental Model

```
org
 └── team (e.g. team.trilogy-innovations)
      └── project (e.g. project.edullm-sat-rw)   [okrs_required flag]
           ├── objective (OKR)                    ← operator/agent owned, has KRs + milestones
           │    └── sub-objective (parent_id, weight)
           ├── workflow run (bd_id)               ← one unit of agent work
           │    ├── checkin     (start→progress→complete/failed)
           │    ├── fact        (verified observation, evidence-gated)
           │    ├── learning    (reusable insight, non-obvious, evidence-gated)
           │    └── artifact    (evidence blob: log, screenshot, query result)
           ├── brief            ← operator→agent standing instruction (org/team/agent scoped)
           └── question         ← agent→operator; answer returns as a future brief
```

**The thread that ties it together: `bd_id`.** Every fact, learning, artifact, and checkin attaches to a workflow run via its `bd_id`. A workflow run binds to an OKR via `target_objective_id`. This gives you a full provenance chain: *insight → the run that produced it → the goal it served → the agent that did it → the evidence that backs it.*

Two distinct knowledge types, deliberately separated:
- **Fact** — a verified, point-in-time observation. "Run 022 hit 92.6% pass rate." Scoped to its project. Not meant to generalize.
- **Learning** — a reusable, generalizable insight that a *different* agent on a *different* project could apply. "LoRA rank 16 beats rank 32 at low sample counts." Tagged with problem-domain `applies_to` terms so it surfaces in cross-silo search.

---

## 2. System Architecture

### 2.1 High-level shape

MemOS is a **single-endpoint intent-RPC API** over a relational database plus a blob store, with a thin web UI for operators.

```
┌─────────────────┐     POST /v1/intent/{intent.name}      ┌──────────────────────┐
│  AI Agents      │ ─────────────────────────────────────► │  Intent Gateway      │
│ (Claude Code,   │     Authorization: Bearer syn_...       │  (one HTTP route)    │
│  Cursor, CI)    │ ◄───────────────────────────────────── │                      │
└─────────────────┘     { ok, data, error, error_type }     └──────────┬───────────┘
                                                                        │
┌─────────────────┐                                          ┌──────────▼───────────┐
│  Operators      │ ── web UI / REST ──►  /okrs, /settings   │  Intent Handlers     │
│  (humans)       │                                          │  (one fn per intent) │
└─────────────────┘                                          └──────────┬───────────┘
                                                  ┌─────────────────────┼──────────────────┐
                                          ┌───────▼───────┐    ┌─────────▼────────┐  ┌──────▼───────┐
                                          │ Postgres      │    │  Blob store      │  │  Async       │
                                          │ (Supabase)    │    │  (S3/Supabase    │  │  workers     │
                                          │ all entities  │    │   Storage)       │  │  (critics,   │
                                          │ + RLS         │    │  artifacts       │  │   DOK grader)│
                                          └───────────────┘    └──────────────────┘  └──────────────┘
```

**Why a single intent endpoint instead of REST resources?** Three reasons, all of which the original leans on:
1. **One auth/validation/logging choke point.** Every call goes through the same envelope, so rate-limiting, scope checks, trust scoring, and audit logging are written once.
2. **Agent-friendly.** The entire API is a flat list of verbs an LLM can reason about from a single manifest file. No REST resource nesting to infer.
3. **Uniform response envelope** makes agent error handling mechanical (see §4.1).

### 2.2 Recommended tech stack

This is what I'd build it on. The original appears to run on Supabase/Postgres (briefs literally reference "Direct Supabase query of agent_choices") behind a custom gateway at `cnu.synapse-os.ai`.

| Layer | Recommendation | Why |
|---|---|---|
| **API runtime** | TypeScript + **Hono** (or Fastify) on Node, OR Python + **FastAPI** | Single POST route dispatching to handlers; both have great validation libs. Pick by team familiarity. The original's manifest examples are TypeScript. |
| **Validation** | **Zod** (TS) / **Pydantic** (Py) | Per-intent input schemas; structured field errors map directly to the `400 → detail.field_errors` contract. |
| **Database** | **Postgres** (via **Supabase**) | Relational integrity for the provenance graph; Supabase gives you auth, Row-Level Security, REST/Realtime, and Storage in one. Strongly recommended for an MVP. |
| **ORM / query** | **Drizzle** (TS) or **SQLAlchemy/SQLModel** (Py), or raw SQL via Supabase client | Drizzle keeps schema-as-code close to the migration story. |
| **Blob store** | **Supabase Storage** or **S3** | Artifacts stored as objects; DB holds only `bucket_path` + `sha256` + metadata. Path scheme: `{project_id}/{artifact_uuid}`. |
| **Vector search** | **pgvector** extension | Semantic `fact.query` / `learning.query`. Embed `claim` text on write; cosine similarity on read. Start with Postgres FTS, add pgvector when you want semantic recall. |
| **Embeddings** | Any small embedding model (OpenAI `text-embedding-3-small`, or local) | One embedding per fact/learning claim, stored in a `vector` column. |
| **Async workers** | **Supabase cron / pg_cron** + edge functions, or a small queue (BullMQ / Celery) | Run the critic, the DOK grader, and brief-escalation sweeps on a schedule. |
| **Web UI** | **Next.js** + Tailwind | Operator dashboard: OKR tree, member/token management, brief authoring, activity feed. |
| **Auth (agents)** | Opaque bearer tokens (`syn_...`), hashed at rest | Enrollment-code → permanent token exchange. See §5. |
| **Auth (humans)** | Supabase Auth (email/OAuth) | Operators log in to the dashboard. |
| **Hosting** | Any container host (Fly.io, Railway, Render) + Supabase cloud | The gateway is stateless; scale horizontally. |

### 2.3 Multi-tenancy & isolation

This is **critical** and a place to be careful. Data is scoped org → team → project. An agent's token is bound to one or more projects/teams. Enforce isolation at the data layer, not just the handler:

- Use **Postgres Row-Level Security**: every row carries `project_id` / `team_id`; policies restrict an agent's token to its granted scopes.
- `project_id` is a **human-readable slug** (`project.edullm-sat-rw`), not just a UUID — used in every agent call. Internally also keep a UUID PK.
- Cross-silo *learning* discovery is the one deliberate exception: learnings are designed to surface across projects via `applies_to` tags — but this is a **curated, problem-domain-tagged read path**, not raw cross-tenant access to facts. Facts stay project-scoped. Treat any unscoped query as a privileged, audited operation.

---

## 3. Data Model (full schema)

Every field below was observed in live API responses. SQL is illustrative (Postgres flavor).

### 3.1 `orgs`, `teams`, `projects`

```sql
create table orgs (
  id          text primary key,              -- 'org'
  name        text not null,
  created_at  timestamptz default now()
);

create table teams (
  id          text primary key,              -- 'team.trilogy-innovations'
  org_id      text references orgs(id),
  name        text not null,
  created_at  timestamptz default now()
);

create table projects (
  id              text primary key,          -- 'project.edullm-sat-rw'  (slug, public)
  uuid            uuid default gen_random_uuid() unique,
  team_id         text references teams(id),
  name            text not null,
  okrs_required   boolean default false,     -- if true, workflow.create REQUIRES target_objective_id
  created_at      timestamptz default now()
);
```

### 3.2 `agents`

```sql
create table agents (
  id                text primary key,         -- 'agent.edullm-sat-rw-divyam-claude'
  display_name      text not null,
  api_token_hash    text not null,            -- store HASH only; raw 'syn_...' shown once
  team_id           text references teams(id),
  scopes            jsonb default '[]',       -- which projects/intents this token may touch
  trust_score       numeric default 0.5,      -- 0..1, moves with compliance (see §6.4)
  status            text default 'active',    -- active | revoked
  last_checkin_at   timestamptz,
  created_at        timestamptz default now()
);
```
Observed: agents have `id`, `display_name`, `trust_score` (e.g. 0.958, 0.977), `last_checkin_at`, team membership, and a permanent token. Tokens are single-use-code → permanent-bearer.

### 3.3 `objectives` (OKRs) + sub-objectives

```sql
create table objectives (
  id                uuid primary key default gen_random_uuid(),
  project_id        text references projects(id),
  bd_id             text,                     -- workflow run that created it (nullable)
  agent_id          text,                     -- creator (e.g. 'agent.bootstrap')
  parent_id         uuid references objectives(id),  -- set for sub-OKRs
  weight            numeric,                  -- sub-OKR contribution weight (e.g. 1.0)
  title             text not null,
  description       text,
  target_completion timestamptz,
  status            text default 'active',    -- active | achieved | abandoned | superseded
  supersedes_id     uuid references objectives(id),
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
```

### 3.4 `key_results` / `milestones`

Observed as one entity used in two roles ("key_results" in OKR list view, "milestones" in objective detail view). Model it as one table:

```sql
create table milestones (
  id               uuid primary key default gen_random_uuid(),
  objective_id     uuid references objectives(id),
  title            text not null,
  description      text,
  position         int,                       -- ordering within the objective
  status           text default 'pending',    -- pending | achieved
  metric_target    numeric,
  metric_current   numeric,
  metric_unit      text,                       -- 'percent' | 'cents per piece' | 'seconds' | 'USD'
  metric_direction text,                       -- 'up' | 'down'  (down = lower is better)
  achieved_at      timestamptz,
  achievement      jsonb                       -- snapshot when achieved (see below)
);
```
`achievement` snapshot shape (embedded when a milestone is achieved):
```json
{
  "id": "uuid",
  "claim": "Agentic Generator holds 99.13% IB pass rate on Digital SAT (229/231 passed)",
  "confidence": "high",
  "evidence_artifact_id": "ff35953a-...",
  "achieved_at": "2026-05-25T07:59:54Z",
  "agent_id": "agent.agent-edullm-sat-rw-parth-main2"
}
```

### 3.5 `workflow_runs`

```sql
create table workflow_runs (
  bd_id               text primary key,        -- 'synapse-5ed13e5e' (generate short id)
  project_id          text references projects(id),
  agent_id            text references agents(id),
  workflow_class      text,                    -- 'investigation' | 'sft-experiment' | 'okr-update' | ...
  title               text not null,
  target_objective_id uuid references objectives(id),
  status              text default 'open',     -- open | complete | failed
  created_at          timestamptz default now(),
  closed_at           timestamptz
);
```
**Rule:** on a project with `okrs_required=true`, `target_objective_id` is mandatory and must reference a **non-abandoned** objective (observed error: `"target_objective_id is abandoned; cannot bind"`).

### 3.6 `checkins`

```sql
create table checkins (
  id                  uuid primary key default gen_random_uuid(),
  bd_id               text references workflow_runs(bd_id),
  project_id          text references projects(id),
  target_objective_id uuid,
  status              text not null,           -- start | progress | blocked | complete | failed
  current_task        text,
  created_at          timestamptz default now()
);
```
The checkin response also returns processing counters: `{ checkin_id, accepted_facts, rejected_facts[], recorded_learnings, recorded_uses }` — i.e. a checkin can carry facts/learnings inline and report how many were accepted.

### 3.7 `facts`

```sql
create table facts (
  id                   uuid primary key default gen_random_uuid(),
  project_id           text references projects(id),
  bd_id                text references workflow_runs(bd_id),
  agent_id             text references agents(id),
  claim                text not null,
  confidence           text not null,          -- low | medium | high
  status               text default 'active',  -- active | retracted | superseded
  evidence_artifact_id uuid references artifacts(id),   -- REQUIRED if confidence >= medium
  embedding            vector(1536),            -- for semantic query
  created_at           timestamptz default now()
);
```

### 3.8 `learnings`

```sql
create table learnings (
  id                   uuid primary key default gen_random_uuid(),
  project_id           text references projects(id),
  bd_id                text references workflow_runs(bd_id),
  agent_id             text references agents(id),
  claim                text not null,
  applies_to           text[] not null,         -- problem-domain tags (3-5), NOT project names
  confidence           text not null,           -- low | medium | high
  non_obvious_marker   text,                    -- REQUIRED if confidence >= medium (>=15 chars)
  evidence_artifact_id uuid references artifacts(id),   -- REQUIRED if confidence >= medium
  status               text default 'active',
  dok_grade            text default 'ungraded', -- ungraded | DOK1 | DOK2 | DOK3 | DOK4
  reuse_count          int default 0,
  reuse_success_count  int default 0,
  reuse_failure_count  int default 0,
  embedding            vector(1536),
  created_at           timestamptz default now()
);
```
The `reuse_*` counters are the **feedback loop**: when another agent applies a learning and reports the outcome, these increment. High-reuse-success learnings are the org's compounding capital.

### 3.9 `artifacts`

```sql
create table artifacts (
  id           uuid primary key default gen_random_uuid(),
  project_id   text references projects(id),
  bd_id        text references workflow_runs(bd_id),
  kind         text,                            -- 'log' | 'screenshot' | 'query_result' | 'benchmark'
  description  text,
  mime_type    text,
  bucket_path  text,                            -- '{project_id}/{artifact_uuid}'
  size_bytes   bigint,
  sha256       text,
  created_at   timestamptz default now()
);
```
Upload accepts `content_base64`; the gateway decodes, writes to blob storage at `bucket_path`, computes `sha256`, and stores metadata. **The raw bytes never live in the DB.** (Observed cap behavior: keep individual artifacts modest, ~hundreds of KB to a few MB; enforce a server-side size limit.)

### 3.10 `briefs`

```sql
create table briefs (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  body           text not null,                 -- markdown; becomes a STANDING INSTRUCTION
  target_kind    text not null,                 -- org | team | agent | project
  target_id      text not null,                 -- 'org' | 'team.x' | 'agent.x' | 'project.x'
  author_id      text,                          -- operator or a critic agent
  supersedes_id  uuid references briefs(id),
  effective_from timestamptz default now(),
  created_at     timestamptz default now()
);

create table brief_acks (
  brief_id   uuid references briefs(id),
  agent_id   text references agents(id),
  acked_at   timestamptz default now(),
  primary key (brief_id, agent_id)
);
```
Briefs are the operator's steering mechanism. An agent fetches all unacked briefs targeting it (directly, or via its team/project/org), **applies each as a standing instruction that outranks its default behavior**, then acks. Unacked > 24h escalates. Briefs supersede each other (`supersedes_id`) so the operator can update guidance without deleting history.

### 3.11 `questions`, `feedback`, `choices`

```sql
create table questions (
  id          uuid primary key default gen_random_uuid(),
  project_id  text, bd_id text, agent_id text,
  subject     text, body text,
  urgency     text,                              -- low | medium | high
  status      text default 'open',               -- open | answered
  answer      text,
  created_at  timestamptz default now()
);
-- An answer is delivered back to the asking agent as a BRIEF on a future run.

create table feedback (
  id        uuid primary key default gen_random_uuid(),
  agent_id  text, bd_id text,
  category  text,                                -- 'platform-bug' | 'wrong-brief' | ...
  body      text,
  created_at timestamptz default now()
);

create table choices (
  id            uuid primary key default gen_random_uuid(),
  agent_id      text, bd_id text,
  description   text,                            -- the decision being made
  outcome       text,                            -- filled in once the result is known (loop-close)
  status        text default 'open',             -- open | resolved
  created_at    timestamptz default now()
);
```
`choices` is a decision-log: record a fork in the road, then **close the loop** by filling `outcome` once known. An open choice with no outcome is "a dead end in the knowledge graph" — a sweep flags stale ones.

---

## 4. The API — every intent

**Endpoint:** `POST /v1/intent/{intent.name}`
**Auth:** `Authorization: Bearer syn_...` on every intent *except* `agent.enroll`.
**Content-Type:** `application/json`.

### 4.1 Response envelope (uniform)

```jsonc
// success
{ "ok": true,  "data": { ... } }
// business-rule failure (HTTP 200, but ok:false)
{ "ok": false, "error": "target_objective_id is abandoned; cannot bind",
  "detail": {}, "error_type": "bad_request" }
// schema/validation failure (HTTP 400)
{ "ok": false, "error": "content_base64: is required",
  "detail": { "field_errors": { "content_base64": ["is required"] },
              "first_error": "content_base64: is required" },
  "error_type": "validation_error" }
```

| HTTP | Meaning | Agent action |
|---|---|---|
| 200 `ok:true` | success | continue |
| 200 `ok:false` | schema valid, business rule failed | read `error`, fix, retry |
| 400 | schema validation failed | fix payload from `detail.field_errors`; never retry unchanged |
| 401 | token invalid/revoked | re-enroll |
| 403 | authenticated but scope missing | ask operator for scope; stop calling that intent |
| 429 | rate limited | exp backoff, cap 60s, ≤5 retries |
| 5xx | platform issue | backoff ≤3×, then `feedback.submit` category `platform-bug` |

### 4.2 Intent catalog

| Intent | Auth? | Input (key fields) | Returns |
|---|---|---|---|
| `agent.enroll` | **No** | `code`, `display_name` | `{ agent_id, api_token:{raw}, scopes }` — **raw token shown once** |
| `brief.fetch` | yes | `project_id`, `include_acked` | `{ briefs[], active_okrs[] }` |
| `brief.ack` | yes | `brief_id` | `{ acked: true }` |
| `objective.query` | yes | `project_id`, `query?` | `{ objectives[] }` (full tree: milestones, status, parent_id) |
| `objective.publish` | yes | `project_id`, `title`, `description`, `parent_id?`, `weight?`, `milestones[]` | `{ objective_id }` — **bypasses critic review** (direct create) |
| `objective.update` | yes | `objective_id`, `status?` / fields | `{ ok }` — e.g. set `status:"abandoned"` |
| `workflow.create` | yes | `project_id`, `workflow_class`, `title`, `target_objective_id` | `{ bd_id }` |
| `checkin` | yes | `project_id`, `bd_id`, `status`, `current_task`, `target_objective_id` | `{ checkin_id, accepted_facts, rejected_facts[], recorded_learnings, recorded_uses }` |
| `artifact.upload` | yes | `project_id`, `bd_id`, `kind`, `description`, `mime_type`, `content_base64` | `{ artifact_id, bucket_path, size_bytes, sha256 }` |
| `fact.record` | yes | `project_id`, `bd_id`, `facts[]` | `{ fact_ids[] }` |
| `fact.query` | yes | `project_id`, `query` | `{ facts[] }` |
| `learning.record` | yes | `project_id`, `bd_id`, `learnings[]` | `{ learning_ids[] }` |
| `learning.query` | yes | `project_id`, `query` | `{ learnings[] }` |
| `milestone.achieve` | yes | `milestone_id`, `evidence_artifact_id`, `note` | `{ ok }` |
| `key_result.update` | yes | `milestone_id`, `metric_current`, `note` | `{ milestone_id, metric_current, metric_target, progress, milestone_status }` |
| `question.ask` | yes | `project_id`, `bd_id`, `subject`, `body`, `urgency` | `{ question_id }` |
| `question.answer` | yes | (answer another agent's question; delivered to it as a brief) | `{ ok }` |
| `feedback.submit` | yes | `category`, `body` | `{ feedback_id }` |
| `choice.record` | yes | `choice_id?`, `description`, `outcome?` | `{ choice_id }` |

**Notes from live behavior:**
- `fact.record`/`learning.record` take **arrays** (`facts[]`, `learnings[]`) — batch in one call.
- The field for artifact bytes is `content_base64` (not `content_b64`, despite a manifest example — validate the real field).
- `learning.record` uses `claim` (not `summary`).
- There is no `milestone.update` for *titles* — you can move metrics (`key_result.update`) and achieve (`milestone.achieve`), but to fix a title you abandon + recreate the objective.
- `objective.publish` writes directly; the operator-facing **"propose sub-OKR" UI form routes through a critic** that can reject for weak alignment/wrong metric direction. The API path is the un-gated one. (Design choice: you may want to gate the API too — see §6.)

---

## 5. One-Time Setup (integration)

This is the full onboarding path, both for the **operator** standing up a project and the **agent** joining it.

### 5.1 Operator side (once per org/team/project)

1. **Create org → team → project** in the dashboard. Set `okrs_required` per project.
2. **Define OKRs.** Create objectives with key-results/milestones (target, unit, direction). These are what agents bind work to.
3. **Mint enrollment codes.** `/settings/members` → generate a **single-use** `enr_code_...` per agent. (Single-use is important: the code is consumed on enroll; afterward the agent holds a permanent token and the code is dead.)
4. **(Optional) Author initial briefs** — standing instructions scoped to the team/project (coding standards, "always attach evidence," etc.).

### 5.2 Agent side (once per agent)

The agent is configured with the base URL and an enrollment code, then exchanges it for a permanent token:

```bash
export MEMOS_URL="https://your-host"
export ENROLLMENT_CODE="enr_code_..."
```
```typescript
const r = await fetch(`${MEMOS_URL}/v1/intent/agent.enroll`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },           // NO bearer header here
  body: JSON.stringify({ code: ENROLLMENT_CODE, display_name: 'my-agent' }),
});
const { ok, data } = await r.json();
// SAVE data.api_token.raw NOW — it is never shown again. Store as MEMOS_TOKEN.
```
From here every call sends `Authorization: Bearer ${MEMOS_TOKEN}`.

### 5.3 How the agent actually wires this in (the integration contract)

This is the part that makes it "automatic." You ship two things to each agent runtime:

1. **A manifest file** (`agents.md` equivalent) served at `GET /agents.md` — the agent reads it once at first launch and on any unfamiliar error. It contains the rules, the runbook, and the intent reference.
2. **A project instruction block** (in the agent's system prompt / `CLAUDE.md` / project memory) that says: *"You have access to MemOS. Your token is in `$MEMOS_TOKEN`. Run the operating loop (below) on every non-trivial task."*

For Claude Code specifically, this lives in `CLAUDE.md` (project instructions) — exactly how the original is wired into this repo. The agent then runs the loop in §6.1 without further human prompting.

---

## 6. Daily Use — The Operating Loop

This is the heartbeat. Every agent, on every non-trivial task, runs this sequence. It's the single most important behavioral spec to implement and to put in the manifest.

### 6.1 The runbook (agent-side, every run)

```
0. brief.fetch  → get { briefs, active_okrs }   (cheap; do it even if usually empty)
1. For each brief: read fully, apply as a standing instruction, then brief.ack it.
2. Pick the OKR whose title matches your work → capture target_objective_id.
      If none matches → question.ask the operator, then STOP (don't proceed unbound).
3. workflow.create { project_id, workflow_class, title, target_objective_id } → bd_id
4. checkin "start"  (every checkin repeats the same target_objective_id + bd_id)
5. Do the work. On milestones: checkin "progress". On blockers: checkin "blocked".
6. Before re-deriving anything: fact.query / learning.query first.
7. When you verify something:
      artifact.upload (evidence)  →  fact.record (cite evidence_artifact_id)
8. When you extract a reusable insight:
      learning.record with applies_to[] + non_obvious_marker + evidence_artifact_id
9. If a milestone is satisfied: milestone.achieve.  If a metric moved: key_result.update.
10. checkin "complete" (or "failed"). ALWAYS close — orphaned runs file a coach brief.
```

### 6.2 The four hard rules (enforce server-side, state in manifest)

These are what keep the store clean. **Enforce them in the gateway, don't just document them** — the original enforces them and *also* runs critics to catch drift.

1. **Every run starts with `brief.fetch` + ack every brief.** Ignored briefs lower trust and eventually revoke the token.
2. **`workflow.create` and every `checkin` must carry `target_objective_id`** on `okrs_required` projects. Missing → reject.
3. **Evidence gate (the "Loop-1" rule):** any fact or learning at `confidence >= medium` **must** carry `evidence_artifact_id`. Upload the artifact first. Reject the write otherwise. *(This is the single highest-leverage rule — it's what stops the store becoming a junk drawer.)*
4. **Non-obvious gate:** a learning at `confidence >= medium` must also carry a `non_obvious_marker` (≥15 chars) explaining why a smart practitioner would miss it. No marker → reject or force `confidence:low`.

### 6.3 `applies_to` tagging rule (cross-silo discovery)

Learnings carry 3–5 `applies_to` tags. **They must be problem-domain terms, not project/product names.** `fine-tuning`, `vllm-deployment`, `prompt-engineering` ✅. `sat-rw`, `inceptbench-workflow` ❌. Project-name tags hide the learning from cross-silo search — defeating the entire point. A critic sweeps for project-name tags and files briefs to offenders.

### 6.4 Trust & quality scoring (the meta-loop)

Two background scores keep the system honest:

- **Agent trust score (0–1).** Moves up with compliance (acked briefs, closed workflows, evidence-backed writes) and down with violations (ignored briefs, orphaned runs, evidence-less medium/high writes). Low trust → token revoked. Observed real values: 0.931, 0.958, 0.977.
- **DOK grade on learnings (Depth of Knowledge, DOK1–4).** A grader (LLM or rules) periodically grades each learning. DOK3+ requires *both* `non_obvious_marker` and `evidence_artifact_id`; otherwise it's demoted to DOK2/DOK1 and drops out of cross-silo discovery. New learnings start `ungraded`.

### 6.5 Critic / coach agents (automated governance)

A distinctive piece: MemOS runs **its own agents** that audit the store and file briefs back at offending agents. Implement these as scheduled workers:

- **Evidence-compliance critic** — scans recent learnings for medium/high confidence without `evidence_artifact_id`; files a brief listing offenders.
- **Tag-hygiene critic** — flags project-name `applies_to` tags.
- **Loop-close critic** — flags `choices` open >X hours with no outcome, and workflow runs with no closing checkin.
- **Coach** — files a brief against an agent that orphans workflows or ignores briefs.

These close the governance loop without a human in it. They're also a great dogfooding story: the platform's own agents are first-class users of the platform.

### 6.6 Operator daily use

- **Read the activity feed** — live checkins, facts, learnings across the fleet.
- **Author/update briefs** — steer behavior in natural language; supersede old guidance.
- **Answer questions** — agent `question.ask` lands in the operator's queue; the answer is pushed back as a brief.
- **Watch OKR rollups** — milestone achievements and KR metric movements roll up the objective tree (sub-OKR `weight` × progress).
- **Manage tokens** — mint/revoke enrollment codes and agent tokens.

---

## 7. Worked Example (end-to-end trace)

A concrete day-in-the-life, drawn from real usage:

```
1.  brief.fetch → 2 briefs ("attach evidence to all learnings", "use problem-domain tags"),
                  active_okrs = [LLM Generator OKR, Cost OKR]
2.  brief.ack ×2
3.  Pick "LLM Generator at 99% pass rate" → target_objective_id = 18577cb6-...
4.  workflow.create { class:'sft-experiment', title:'Record SFT hyperparam learnings' } → synapse-3d95df89
5.  checkin start
6.  learning.query "lora rank" → store already knows "rank 16 > rank 32 at low samples". Reuse it; skip re-derivation.
7.  artifact.upload { kind:'log', description:'run011 vs run014 comparison', content_base64 } → b1e8b0cf-...
8.  learning.record [{
       claim:'3 epochs > 5 epochs at ~125 samples (~5pp drop)',
       applies_to:['fine-tuning','epoch-selection','overfitting','structured-generation'],
       confidence:'medium',
       non_obvious_marker:'standard guidance says 3-5 epochs uniformly; at sub-200 samples 5ep is a reliable regression',
       evidence_artifact_id:'b1e8b0cf-...'
    }] → learning_ids:[...]
9.  milestone.achieve / key_result.update { milestone_id, metric_current:95 } → progress 0.96
10. checkin complete
```
Provenance now queryable: the learning → its artifact → the run `synapse-3d95df89` → the OKR `18577cb6` → the agent. Another agent on a different project can `learning.query "epochs overfitting"` and find it (because the tags are problem-domain, not "sat-rw").

---

## 8. Build Plan (phased)

Build it in slices that are each independently useful. Don't build the critics before the core write path works.

### Phase 0 — Skeleton (week 1)
- Postgres schema (§3) on Supabase. RLS policies for project scoping.
- Intent gateway: one POST route, envelope (§4.1), Zod/Pydantic per-intent schemas.
- `agent.enroll` (code→token), token hashing, bearer auth middleware.
- `workflow.create`, `checkin`. **Milestone: an agent can open and close a run.**

### Phase 1 — Knowledge writes (week 2)
- `artifact.upload` → blob store, sha256, bucket_path.
- `fact.record` / `learning.record` with the **evidence gate** + **non-obvious gate** enforced server-side.
- `fact.query` / `learning.query` via Postgres FTS. **Milestone: evidence-gated writes + keyword recall.**

### Phase 2 — Goals (week 3)
- `objective.publish` / `objective.query` / `objective.update` (sub-OKRs, weight, status).
- `milestone.achieve`, `key_result.update`, rollup math.
- `brief.fetch` returns `active_okrs`. **Milestone: agents bind work to OKRs; metrics roll up.**

### Phase 3 — Steering (week 4)
- `briefs` + `brief.ack`, org/team/agent/project targeting, supersede chain, 24h escalation sweep.
- `question.ask` / `question.answer` (answer → brief delivery).
- Operator dashboard (Next.js): OKR tree, activity feed, brief authoring, member/token mgmt.
- **Milestone: a human can steer the fleet end-to-end.**

### Phase 4 — Governance & quality (week 5+)
- `pgvector` semantic query; embed claims on write.
- Trust scoring; DOK grader worker; the critic agents (§6.5).
- `feedback.submit`, `choice.record` + loop-close sweep.
- `reuse_count` tracking when a learning is applied.
- **Milestone: the store stays clean without a human babysitting it.**

---

## 9. Design Decisions Worth Stealing (and pitfalls)

**Steal these — they're the non-obvious parts that make it work:**
1. **Evidence-gated writes.** Without this you get a junk drawer nobody queries. It is THE load-bearing rule.
2. **Fact vs learning split.** Point-in-time observations and reusable insights have different lifecycles, query paths, and quality bars. Don't merge them.
3. **Problem-domain tags for cross-silo reach.** The whole value prop is an insight escaping its origin project. Project-name tags silently kill that.
4. **`bd_id` provenance thread.** Every artifact of work chains back to a run, an OKR, an agent, and evidence. This is what makes the store *trustworthy*, not just full.
5. **Single intent endpoint + uniform envelope + a manifest.** Makes the API legible to an LLM from one file, and makes cross-cutting concerns (auth, rate-limit, audit, trust) single-point.
6. **The platform dogfoods itself** via critic/coach agents that are themselves MemOS clients.
7. **Single-use enrollment codes → permanent hashed bearer tokens.** Simple, revocable, no secret-rotation dance.

**Pitfalls observed (avoid):**
- **Unicode in stored titles.** The original stored `≤`/`—` as mojibake (`=`/`◆`). Normalize to ASCII or store/serve UTF-8 cleanly end-to-end and test it.
- **No `milestone.update` for titles** forces abandon+recreate to fix a typo. Add an update path.
- **Abandoned-objective binding error** is only caught at `workflow.create`. Surface bindability earlier (in `brief.fetch`'s `active_okrs`, only list bindable objectives — which it does).
- **Critic feedback can lag** (answers arrive as briefs on a *future* run), so an agent can't get a synchronous "is this OK?" Consider a synchronous validate endpoint for high-stakes writes.
- **Cross-tenant isolation must be enforced at the DB (RLS), not the handler.** A scoping bug in one handler shouldn't leak another team's facts.

---

## 10. Quick Reference — Field Cheatsheet

```
confidence:        low | medium | high      (>=medium ⇒ evidence required)
objective.status:  active | achieved | abandoned | superseded
milestone.status:  pending | achieved
metric_direction:  up (higher better) | down (lower better)
checkin.status:    start | progress | blocked | complete | failed
brief.target_kind: org | team | project | agent
urgency:           low | medium | high
dok_grade:         ungraded | DOK1 | DOK2 | DOK3 | DOK4
artifact.kind:     log | screenshot | query_result | benchmark | ...
id formats:        project.<slug>  team.<slug>  agent.<slug>  bd_id=synapse-<short>  others=uuid
token:             syn_<opaque>   enrollment=enr_code_<opaque>  (single-use)
envelope:          { ok, data } | { ok:false, error, detail.field_errors, error_type }
```

---

*This doc was reverse-engineered from the Synapse OS agent manifest and live API response shapes (entity fields, status enums, error contracts, and the operating loop). All entity fields and enums listed were observed in real responses. Build names ("MemOS") are placeholders.*

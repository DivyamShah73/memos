# MemOS — Data Model (LLD)

> Copy to `docs/DATA_MODEL.md`. This is the low-level design: the ER diagram, every table with columns/indexes, the RLS strategy, the provenance graph, and the key query patterns. The canonical schema lives in code (`packages/api/src/db/schema.ts` via Drizzle); this doc explains the *why* and keeps the diagram.

---

## 1. ER diagram

```
orgs ──1:N── teams ──1:N── projects
                                 │
        ┌────────────────────────┼───────────────────────────────┐
        │                        │                               │
        ▼                        ▼                               ▼
   objectives                workflow_runs                    briefs
   (OKRs)                    (bd_id)                          (org/team/
     │  │                     │  │  │  │                       project/agent
     │  └──self FK            │  │  │  └── checkins             targeted)
     │     parent_id          │  │  │                              │
     ▼     (sub-OKR)          │  │  └──── facts ──┐            brief_acks
   milestones                 │  │                ├─► artifacts   (agent×brief)
   (KR/milestone)             │  └──── learnings ─┘   (evidence)
        ▲                     │
        │ achievement         └──── target_objective_id ──► objectives
        │ snapshot
        └── evidence_artifact_id ──► artifacts

   agents ──N:1── teams          questions / feedback / choices
     │  (token, trust_score)       (agent ↔ operator dialogue + decision log)
     └── authors facts/learnings/checkins/artifacts (agent_id on each)
```

**Reading the graph:** the spine is `project → workflow_run (bd_id) → {facts, learnings, artifacts, checkins}`. A workflow run points up to an `objective` via `target_objective_id`. Facts/learnings point sideways to an `artifact` via `evidence_artifact_id`. Objectives self-reference for sub-OKRs (`parent_id`). This is the **provenance graph** the dashboard renders with React Flow.

---

## 2. Tables

> Drizzle/Postgres flavor. `text PK` for human-readable slugs; `uuid` for internal entities. Every tenant-scoped table carries `project_id` and gets RLS (§4).

### 2.1 Tenancy

```sql
orgs       ( id text pk, name, created_at )
teams      ( id text pk, org_id → orgs, name, created_at )
projects   ( id text pk,                       -- 'project.<slug>' (public, used in every agent call)
             uuid uuid unique default gen_random_uuid(),
             team_id → teams, name,
             okrs_required boolean default false,   -- gates workflow.create
             created_at )
```

### 2.2 Agents

```sql
agents ( id text pk,                         -- 'agent.<slug>'
         display_name text,
         api_token_hash text,                -- HASH only; raw 'syn_...' shown once
         team_id → teams,
         scopes jsonb default '[]',          -- project ids this token may touch
         trust_score numeric default 0.5,    -- 0..1
         status text default 'active',       -- active | revoked
         last_checkin_at timestamptz,
         created_at )
```
`enrollment_codes ( code text pk, team_id, scopes jsonb, used_by text null, used_at, created_at )` — single-use; consumed on `agent.enroll`.

### 2.3 Objectives & milestones

```sql
objectives ( id uuid pk,
             project_id → projects,
             bd_id text null,                -- run that created it (nullable; bootstrap-created OKRs have null)
             agent_id text,                  -- creator
             parent_id uuid → objectives null,   -- set on sub-OKRs
             weight numeric null,            -- sub-OKR contribution weight
             title, description,
             target_completion timestamptz null,
             status text default 'active',   -- active | achieved | abandoned | superseded
             supersedes_id uuid → objectives null,
             created_at, updated_at )

milestones ( id uuid pk,                     -- serves BOTH "key_result" and "milestone" roles
             objective_id → objectives,
             project_id → projects,          -- denormalized from objective (see note below) for uniform RLS
             title, description,
             position int,
             status text default 'pending',  -- pending | achieved
             metric_target numeric,
             metric_current numeric null,
             metric_unit text,               -- 'percent' | 'cents per piece' | 'seconds' | 'USD'
             metric_direction text,          -- 'up' (higher better) | 'down' (lower better)
             achieved_at timestamptz null,
             achievement jsonb null )        -- snapshot {claim, confidence, evidence_artifact_id, achieved_at, agent_id}
```

### 2.4 Workflow runs & checkins

```sql
workflow_runs ( bd_id text pk,              -- 'memos-<short>' (generate short id)
                project_id → projects,
                agent_id → agents,
                workflow_class text,        -- 'investigation' | 'sft-experiment' | 'okr-update' | ...
                title,
                target_objective_id uuid → objectives null,  -- required if project.okrs_required
                status text default 'open', -- open | complete | failed
                created_at, closed_at )

checkins ( id uuid pk,
           bd_id → workflow_runs,
           project_id → projects,
           target_objective_id uuid null → objectives,  -- FK backstop (mirrors the run's objective)
           status text,                     -- start | progress | blocked | complete | failed
           current_task text,
           created_at )
```

### 2.5 Knowledge: facts, learnings, artifacts

```sql
facts ( id uuid pk,
        project_id → projects, bd_id → workflow_runs, agent_id → agents,
        claim text,
        confidence text,                    -- low | medium | high
        status text default 'active',       -- active | retracted | superseded
        evidence_artifact_id uuid → artifacts null,   -- REQUIRED if confidence >= medium
        embedding vector(1536) null,
        created_at )

learnings ( id uuid pk,
            project_id → projects, bd_id → workflow_runs, agent_id → agents,
            claim text,
            applies_to text[],              -- 3-5 problem-domain tags (NOT project names)
            confidence text,                -- low | medium | high
            non_obvious_marker text null,   -- REQUIRED (>=15 chars) if confidence >= medium
            evidence_artifact_id uuid → artifacts null,   -- REQUIRED if confidence >= medium
            status text default 'active',
            dok_grade text default 'ungraded',  -- ungraded | DOK1..DOK4
            reuse_count int default 0,
            reuse_success_count int default 0,
            reuse_failure_count int default 0,
            embedding vector(1536) null,
            created_at )

artifacts ( id uuid pk,
            project_id → projects, bd_id → workflow_runs,
            kind text,                      -- log | screenshot | query_result | benchmark
            description, mime_type,
            bucket_path text,               -- '{project_id}/{artifact_uuid}'  (bytes in blob store)
            size_bytes bigint, sha256 text,
            created_at )
```

### 2.6 Steering: briefs, questions, feedback, choices

```sql
briefs ( id uuid pk, title, body text,      -- markdown; becomes a STANDING INSTRUCTION
         target_kind text,                  -- org | team | project | agent
         target_id text,                    -- 'org' | 'team.x' | 'project.x' | 'agent.x'
         author_id text, supersedes_id uuid → briefs null,
         effective_from timestamptz, created_at )

brief_acks ( brief_id → briefs, agent_id → agents, acked_at,
             primary key (brief_id, agent_id) )

questions ( id uuid pk, project_id, bd_id, agent_id,
            subject, body, urgency text,    -- low | medium | high
            status text default 'open',     -- open | answered
            answer text null, created_at )  -- answer delivered back as a brief

feedback ( id uuid pk, agent_id, bd_id, category text, body, created_at )

choices ( id uuid pk, agent_id, bd_id,
          project_id → projects,            -- denormalized (see note below) for uniform RLS
          description,
          outcome text null,                -- filled once known (loop-close)
          status text default 'open',       -- open | resolved
          created_at )
```

> **Phase 0 schema note — denormalized `project_id` on `milestones` and `choices`.**
> The spec scopes these two tables indirectly (milestones via `objective_id`, choices via
> `bd_id`). The implementation adds a denormalized `project_id` to both so the uniform
> `project_id`-keyed RLS policy template (§4) applies without a join/subquery, honoring the
> "every tenant-scoped table carries `project_id`" rule. `questions` already carries it;
> `feedback` is intentionally agent-scoped (can concern the platform itself) and is
> handler-enforced, not project-RLS'd. The canonical schema is
> `packages/api/src/db/schema.ts`; this doc is kept in sync with it.

---

## 3. Indexes

```sql
-- hot filter/join columns
create index on facts        (project_id, created_at desc);
create index on facts        (bd_id);
create index on learnings    (project_id, created_at desc);
create index on learnings    (bd_id);
create index on learnings    using gin (applies_to);          -- tag search
create index on workflow_runs(project_id, status);
create index on workflow_runs(target_objective_id);
create index on checkins     (bd_id, created_at);
create index on milestones   (objective_id, position);
create index on objectives   (project_id, status);
create index on objectives   (parent_id);
create index on briefs       (target_kind, target_id, effective_from desc);
create index on artifacts    (project_id, bd_id);

-- semantic search (add when pgvector is enabled)
create index on facts     using hnsw (embedding vector_cosine_ops);
create index on learnings using hnsw (embedding vector_cosine_ops);

-- full-text fallback (before/alongside pgvector)
create index on facts     using gin (to_tsvector('english', claim));
create index on learnings using gin (to_tsvector('english', claim));
```

---

## 4. Row-Level Security (the isolation boundary)

Isolation lives here, not in handlers. **Roles are separated:** migrations run as the
owner/superuser; the gateway connects at runtime as the non-owner role `memos_app`. Per
request the gateway runs
`select set_config('memos.agent_projects', '{project.a,project.b}', true);`
derived from the authed token's `scopes` (ADR-004). Then every tenant-scoped table gets
`ENABLE` **and `FORCE`** row level security plus four policies. The predicate wraps the
setting in `nullif(…, '')` so a never-set GUC (NULL) **and** an empty-string GUC both
default-deny instead of erroring — a custom dotted GUC reverts to `''` (not NULL) after a
`SET LOCAL`, and a bare `''::text[]` raises "malformed array literal" (migration 0004):

```sql
alter table facts enable row level security;
alter table facts force  row level security;

create policy facts_select on facts for select
  using (project_id = any (nullif(current_setting('memos.agent_projects', true), '')::text[]));
create policy facts_insert on facts for insert
  with check (project_id = any (nullif(current_setting('memos.agent_projects', true), '')::text[]));
create policy facts_update on facts for update
  using      (project_id = any (nullif(current_setting('memos.agent_projects', true), '')::text[]))
  with check (project_id = any (nullif(current_setting('memos.agent_projects', true), '')::text[]));
create policy facts_delete on facts for delete
  using (project_id = any (nullif(current_setting('memos.agent_projects', true), '')::text[]));

grant select, insert, update, delete on facts to memos_app;
```
UPDATE needs both `using` (which rows are visible to update) and `with check` (what the new
values may be) or a row could be moved into another tenant. Repeat the whole block for
`learnings`, `artifacts`, `workflow_runs`, `checkins`, `objectives`, `milestones`,
`questions`, `choices` (the 9 project-scoped tables). The canonical SQL is
`infra/migrations/0002_rls.sql`.

**Tables NOT under project_id RLS (Phase 0):** the control-plane tables `orgs, teams,
projects, agents, enrollment_codes, brief_acks, feedback` are touched during enrollment/auth
*before* a project scope exists — a `project_id` policy there would deadlock the gateway out
of its own auth tables. `briefs` are identity-targeted (org/team/project/agent) and get a
distinct identity policy in Phase 6; handler-enforced until then. All these still receive
`memos_app` table GRANTs so the gateway can read/write them.

**Deliberate exception:** cross-silo *learning* discovery (the whole value prop) is a curated read path that may span projects — implement it as a **separate, audited, problem-domain-tag-filtered** query that returns learnings only (never facts), with `evidence_artifact_id` and `non_obvious_marker` present. Treat unscoped access as privileged.

---

## 5. Key query patterns

**`learning.query` (semantic + scoped):**
```sql
-- 1. embed the query string → :qvec
-- 2. within scope, rank by cosine similarity, tie-break by reuse success + recency
select *, 1 - (embedding <=> :qvec) as score
from learnings
where status = 'active'
order by embedding <=> :qvec, reuse_success_count desc, created_at desc
limit 20;
```
RLS auto-restricts to the agent's projects (or the curated cross-silo path applies).

**OKR rollup (dashboard):** for each objective, `progress = Σ(child.weight × child_progress)` for sub-OKRs, else mean of milestone `metric_current/metric_target` (respecting `metric_direction` for down-is-better metrics). Compute in a view or the API layer.

**Brief fetch for an agent:** all briefs where `(target_kind,target_id)` matches the agent's identity/team/project/org, `effective_from <= now()`, not superseded, and not in `brief_acks` for this agent (when `include_acked=false`).

**Provenance chain (React Flow):** start from a `learning`, walk `evidence_artifact_id → artifact`, `bd_id → workflow_run`, `target_objective_id → objective`, `agent_id → agent`. One recursive-ish fetch builds the node/edge set.

---

## 6. Lifecycle & state machines

```
objective.status:   active ──► achieved
                       │  └──► superseded (supersedes_id chain)
                       └─────► abandoned        (cannot bind new workflow_runs)

milestone.status:   pending ──► achieved   (sets achieved_at + achievement snapshot)

workflow_run.status: open ──► complete
                        └───► failed       (orphan if never closed → coach brief)

fact.status:        active ──► retracted | superseded
learning:           ungraded ──► DOK1..DOK4   (grader); reuse_* move on application
choice.status:      open ──► resolved        (outcome filled; stale-open → critic brief)
```

---

## 7. Seeding & testing notes
- Seed one coherent org so the provenance graph has depth (see the `demo-seed` skill).
- Invariant tests live next to handlers; the `evidence-gate-check` skill is the merge gate for any write-path change.
- Test UTF-8 round-trip (`≤`, `—`, emoji) on `claim`/`title` — the system we modeled corrupted these; we won't.

## 8. Human identity (Phase 11 / ADR-009)
- **`users`** — humans (distinct from agents), org-bounded: `org_id`, unique `lower(email)`, scrypt
  `password_hash` (low-entropy secret; agent tokens stay SHA-256), `display_name`, `status`.
- **`memberships`** — `(user_id, scope_kind ∈ org|team|project, scope_id) → role ∈ ceo|manager|member`,
  unique per `(user, scope_kind, scope_id)`. A user's read scope is the union of their memberships
  (CEO → all org projects, manager → team projects, member → the project).
- **`org_id` denormalized** onto `agents`, `enrollment_codes`, `projects` so auth resolves the org
  from a single by-credential row (no `teams` join) and isolation keys on it uniformly.
- **Isolation:** `users` + `memberships` are FORCE-RLS'd on the `memos.org_id` GUC (org B never sees
  org A's people). The data plane stays project-scoped (its cross-org isolation is implied — an agent
  only ever holds its own org's project ids). Structural-table enumeration RLS lands with the
  enumeration features (Phase 13/14).

The canonical, always-current schema is the Drizzle definition in code. When they diverge, **code wins** — update this doc to match (it's documentation, not the source of truth).

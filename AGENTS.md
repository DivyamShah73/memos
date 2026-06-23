# AGENTS.md — using MemOS as an AI coding agent

MemOS is your team's **shared, persistent memory**. Before you re-derive something, check whether
another agent already learned it. As you work, publish what you verify so the next agent benefits.
You reach it through one endpoint — `POST /v1/intent/{name}` — or the [`@memos/agent`](sdk/memos-agent) client.

## The operating loop

1. **Enroll** once: exchange a single-use code for a token (`agent.enroll`). Store it as `MEMOS_TOKEN`.
2. **Fetch your briefs** (`brief.fetch`) — standing instructions targeting you / your team / project,
   plus the project's active OKRs. `brief.ack` what you've read.
3. **Open a workflow** (`workflow.create`) → you get a `bd_id`. Everything you record threads onto it
   (the provenance spine). On OKR-required projects, bind it to an objective.
4. **Query before deriving** (`fact.query`, `learning.query`, `learning.list`) — reuse beats rework.
5. **Work**, sending `checkin`s as your state changes.
6. **Publish what you verified:**
   - `artifact.upload` your evidence (logs, benchmarks, screenshots) → get an `artifact_id`.
   - `fact.record` observations; `learning.record` reusable insights.
7. **Advance goals**: `key_result.update` to move a metric; `milestone.achieve` when you hit one.
8. **Close** the workflow (`checkin` with `status:"complete"`).

## The two gates (your writes are rejected if you skip them)

- **Evidence gate** — any fact or learning at `confidence ≥ medium` MUST carry an
  `evidence_artifact_id` (an artifact you uploaded in the same project + run). `low` may be unbacked.
- **Non-obvious gate** — a learning at `confidence ≥ medium` MUST also carry a `non_obvious_marker`
  (≥ 15 chars) explaining why it's not obvious.

A medium/high write without these returns a `validation_error` (HTTP 400). This is deliberate: the
store stays trustworthy because every confident claim is provable and every learning is non-trivial.

## Tagging

`applies_to` on a learning is a **problem-domain** tag (`fine-tuning`, `vllm-deployment`,
`postgres-rls`) — never a project or product name. Domain tags are what let your learning surface to
an agent in a different silo facing the same problem.

## Tenancy

You only ever see your own org/team/project's data — isolation is enforced at the database (RLS),
not by convention. A query in project A can never return project B's facts.

## Quickstart

```ts
import { MemosClient } from "@memos/agent";
const { client } = await MemosClient.enroll("http://127.0.0.1:8787", code, "my-agent");
const { bd_id } = await client.workflowCreate({ project_id, workflow_class: "investigation", title });
// upload evidence → record an evidence-backed fact → query the store → achieve a milestone → close
```

Full intent reference: [`docs/API.md`](docs/API.md).

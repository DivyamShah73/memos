---
name: demo-seed
description: Generate realistic, screenshot-ready seed data for MemOS — a believable org with teams, projects, agents, OKRs, briefs, and a rich graph of facts/learnings/artifacts. Use before demos, screenshots, or recording the README Loom.
---

# MemOS Demo Seed

A portfolio project lives or dies on the demo. Empty tables screenshot badly. This skill populates a believable, dense, internally-consistent dataset so the dashboard looks alive and the provenance graph has depth.

## Output: `packages/api/src/db/seed.ts` (idempotent, run via `pnpm db:seed`)

### Build a coherent narrative (not random noise)
Seed ONE believable org so everything connects:

- **1 org**, **2 teams** (e.g. `team.ml-platform`, `team.growth`).
- **3 projects** across them (e.g. `project.rag-search`, `project.onboarding-funnel`, `project.cost-optimization`). Mark one `okrs_required=true`.
- **5-6 agents** with varied `trust_score` (0.62 → 0.98) and `last_checkin_at` spread across the last week. Include one low-trust agent (for the leaderboard contrast) and one platform "critic" agent.
- **Per project: 1-2 OKRs**, each with 3-6 milestones, mixed `status` (some achieved, some pending), realistic `metric_current` vs `metric_target` so rollup bars show partial progress. Use varied units (percent, cents per piece, seconds, USD) and both directions (up/down).
- **8-12 workflow runs** across agents, mixed `status` (mostly complete, a couple open, one failed).
- **15-25 facts** and **15-25 learnings** attached to those runs — with REAL-sounding claims (draw domain flavor from RAG, onboarding, infra). Most medium/high ones cite an artifact; include a couple low-confidence unbacked ones. `applies_to` uses problem-domain tags only.
- **8-10 artifacts** (kind: log/screenshot/benchmark) referenced by the facts/learnings.
- **4-6 briefs**: a mix of org-scoped (compliance reminders), team-scoped, and one question-answer brief. Leave 1-2 unacked so the dashboard shows the "pending briefs" state.
- **2-3 open questions** and a couple of `choices` (one closed with outcome, one open/stale for the loop-close critic to flag).

### Make it screenshot-perfect
- Timestamps spread realistically (not all `now()`), so the activity feed has a believable timeline.
- At least one learning with a high `reuse_count` and `reuse_success_count` (the "compounding capital" story).
- One rich provenance chain: a high-reuse learning → its artifact → its run → its OKR → its agent, so the React Flow graph has a deep, clickable path to show off.
- UTF-8 content with a `≤`, a `—`, and an emoji somewhere to prove encoding is clean.

### Idempotency
Truncate-then-insert, or upsert by stable IDs, so re-running `pnpm db:seed` is safe.

## Done when
`pnpm db:seed` runs clean, the dashboard's OKR tree / activity feed / provenance graph / trust leaderboard all look full and believable, and there's at least one deep provenance chain worth screenshotting.

# MemOS — API Reference

The entire API is a single endpoint: **`POST /v1/intent/{intent.name}`**. Every call goes
through one choke point (auth → rate-limit → validation → handler) and returns the same
envelope (ADR-001). There is also a `GET /health` liveness probe.

Base URL (local dev): `http://localhost:8787`.

## Response envelope

Every response is one of:

```jsonc
// success
{ "ok": true, "data": { /* intent-specific */ } }

// business-rule failure — HTTP 200, but ok:false (read error, fix, retry)
{ "ok": false, "error": "enrollment code already used", "detail": {}, "error_type": "bad_request" }

// schema/validation failure — HTTP 400
{ "ok": false, "error": "code: is required",
  "detail": { "field_errors": { "code": ["is required"] }, "first_error": "code: is required" },
  "error_type": "validation_error" }
```

| HTTP | When | `error_type` | Agent action |
|---|---|---|---|
| 200 `ok:true` | success | — | continue |
| 200 `ok:false` | schema valid, business rule failed | `bad_request` | read `error`, fix, retry |
| 400 | schema validation failed | `validation_error` | fix from `detail.field_errors`; never retry unchanged |
| 401 | token missing/invalid/revoked | `unauthorized` | re-enroll |
| 403 | authenticated but scope missing | `forbidden` | ask operator for scope |
| 404 | unknown intent | `not_found` | check the intent name |
| 429 | rate limited | `rate_limited` | back off; honor `Retry-After` |
| 5xx | platform issue | `platform_error` | backoff + retry; then `feedback.submit` |

**Auth:** every intent requires `Authorization: Bearer syn_…` **except `agent.enroll`**. A
tokenless call to any authed intent (even one not yet implemented) returns **401** — the
gateway checks auth before revealing whether an intent exists.

---

## Intents

### `agent.enroll` — exchange a single-use code for a permanent token
- **Auth:** none (the only public intent).
- **Input:** `{ "code": string, "display_name": string }`
- **Returns:** `{ "agent_id": string, "api_token": { "raw": "syn_…" }, "scopes": string[] }`
- **Notes:** the raw token is shown **once** — store it as `MEMOS_TOKEN`. Only its SHA-256
  hash is persisted (ADR-003). The enrollment code is single-use (atomic claim); a reused or
  unknown code returns `ok:false`.

```bash
curl -s -X POST http://localhost:8787/v1/intent/agent.enroll \
  -H 'content-type: application/json' \
  -d '{"code":"enr_code_…","display_name":"my-agent"}'
# → { "ok": true, "data": { "agent_id": "agent.my-agent-3f9a1c",
#       "api_token": { "raw": "syn_…" }, "scopes": ["project.demo"] } }
```

### `workflow.create` — open a unit of work (→ bd_id)
- **Auth:** bearer; agent must be scoped to `project_id` (else 403).
- **Input:** `{ "project_id": string, "workflow_class": string, "title": string, "target_objective_id"?: uuid }`
- **Returns:** `{ "bd_id": "memos-…" }`
- **Notes:** the `bd_id` is the provenance spine every later fact/learning/artifact/checkin
  threads onto. On `okrs_required` projects, `target_objective_id` is mandatory and must
  reference a non-abandoned objective in the project — otherwise `ok:false` (`"…is required on
  this project"` / `"…not found in this project"` / `"target_objective_id is abandoned; cannot
  bind"`). Enforced under the agent's RLS scope (ADR-004).

```bash
curl -s -X POST $API/v1/intent/workflow.create -H "authorization: Bearer $TOK" \
  -H 'content-type: application/json' \
  -d '{"project_id":"project.demo","workflow_class":"investigation","title":"Investigate X","target_objective_id":"…"}'
# → { "ok": true, "data": { "bd_id": "memos-d20f9491" } }
```

### `checkin` — record a state change on a run
- **Auth:** bearer; agent must be scoped to `project_id`.
- **Input:** `{ "project_id": string, "bd_id": string, "status": "start"|"progress"|"blocked"|"complete"|"failed", "current_task"?: string, "target_objective_id"?: uuid }`
- **Returns:** `{ "checkin_id": uuid, "accepted_facts": 0, "rejected_facts": [], "recorded_learnings": 0, "recorded_uses": 0 }`
- **Notes:** `complete`/`failed` close the run (sets `closed_at`); a checkin on an unknown
  (or other-tenant) `bd_id` → `"unknown workflow run"`; on a closed run → `"workflow run
  already closed"`. On `okrs_required` projects every checkin repeats the run's
  `target_objective_id`. The facts counters are 0 until inline-fact recording lands (Phase 3).

```bash
curl -s -X POST $API/v1/intent/checkin -H "authorization: Bearer $TOK" \
  -H 'content-type: application/json' \
  -d '{"project_id":"project.demo","bd_id":"memos-d20f9491","status":"complete","current_task":"done"}'
# → { "ok": true, "data": { "checkin_id": "…", "accepted_facts": 0, ... } }
```

### `artifact.upload` — store evidence bytes (→ MinIO)
- **Auth:** bearer; agent scoped to `project_id`.
- **Input:** `{ "project_id": string, "bd_id": string, "kind": string, "description"?: string, "mime_type": string, "content_base64": string }`
- **Returns:** `{ "artifact_id": uuid, "bucket_path": string, "size_bytes": number, "sha256": string }`
- **Notes:** bytes go to the blob store at `{project_id}/{artifact_id}`; only metadata + `sha256` land in Postgres. Cite the `artifact_id` from a fact/learning to satisfy the evidence gate (it must be the **same project + same run**).

### `fact.record` — record verified observations (batched, evidence-gated)
- **Auth:** bearer; agent scoped to `project_id`.
- **Input:** `{ "project_id": string, "bd_id": string, "facts": [{ "claim": string, "confidence": "low"|"medium"|"high", "evidence_artifact_id"?: uuid }] }`
- **Returns:** `{ "fact_ids": uuid[] }`
- **Notes:** **evidence gate** — `confidence ≥ medium` requires an `evidence_artifact_id` (400 if missing) that exists in the same project/run (`ok:false` otherwise — covers non-existent + cross-tenant). `low` may be unbacked. All-or-nothing batch.

### `learning.record` — record reusable insights (batched, evidence + non-obvious gated)
- **Auth:** bearer; agent scoped to `project_id`.
- **Input:** `{ "project_id": string, "bd_id": string, "learnings": [{ "claim": string, "applies_to": string[], "confidence": …, "non_obvious_marker"?: string, "evidence_artifact_id"?: uuid }] }`
- **Returns:** `{ "learning_ids": uuid[] }`
- **Notes:** at `confidence ≥ medium`, BOTH an `evidence_artifact_id` AND a `non_obvious_marker` (≥15 chars) are required (400 otherwise). `applies_to` are problem-domain tags, not project names.

```bash
# upload evidence, then record an evidence-backed fact
ART=$(curl -s -X POST $API/v1/intent/artifact.upload -H "authorization: Bearer $TOK" \
  -H 'content-type: application/json' \
  -d "{\"project_id\":\"project.demo\",\"bd_id\":\"$BD\",\"kind\":\"log\",\"mime_type\":\"text/plain\",\"content_base64\":\"$(printf 'evidence' | base64 -w0)\"}" \
  | sed -n 's/.*"artifact_id":"\([0-9a-f-]*\)".*/\1/p')
curl -s -X POST $API/v1/intent/fact.record -H "authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d "{\"project_id\":\"project.demo\",\"bd_id\":\"$BD\",\"facts\":[{\"claim\":\"D7 dropped 11pp\",\"confidence\":\"medium\",\"evidence_artifact_id\":\"$ART\"}]}"
# → { "ok": true, "data": { "fact_ids": ["…"] } }
```

### `fact.query` — keyword search over a project's facts
- **Auth:** bearer; agent scoped to `project_id`.
- **Input:** `{ "project_id": string, "query": string, "limit"?: number (default 20, max 50) }`
- **Returns:** `{ "facts": [{ "id": uuid, "claim": string, "confidence": …, "bd_id": string, "created_at": ts, "score": number }] }`
- **Notes:** Postgres full-text search on `claim` (ranked by relevance, then recency). Scoped to the one `project_id` (RLS + explicit filter) — never returns another project's rows.

### `learning.query` — keyword search over a project's learnings
- **Auth:** bearer; agent scoped to `project_id`.
- **Input:** `{ "project_id": string, "query": string, "applies_to"?: string[], "limit"?: number }`
- **Returns:** `{ "learnings": [{ "id", "claim", "applies_to", "confidence", "dok_grade", "reuse_count", "reuse_success_count", "non_obvious_marker", "created_at", "score" }] }`
- **Notes:** ranked by relevance, then `reuse_success_count`, then recency. Optional `applies_to` filters by problem-domain tag (array overlap). Cross-silo (cross-project) discovery is a separate Phase-6 path; this query stays within `project_id`.

```bash
curl -s -X POST $API/v1/intent/learning.query -H "authorization: Bearer $TOK" \
  -H 'content-type: application/json' \
  -d '{"project_id":"project.demo","query":"vllm deployment"}'
# → { "ok": true, "data": { "learnings": [ { "claim": "vllm gpu deployment tuning…", "score": 0.06, … } ] } }
```

### `objective.publish` — create an objective / sub-OKR (with optional inline milestones)
- **Auth:** bearer; agent scoped to `project_id`.
- **Input:** `{ "project_id": string, "bd_id": string, "title": string, "description"?: string, "target_completion"?: iso8601, "parent_id"?: uuid, "weight"?: number, "milestones"?: [{ "title": string, "description"?: string, "position"?: int, "metric_target"?: number, "metric_current"?: number, "metric_unit"?: string, "metric_direction"?: "up"|"down" }] }`
- **Returns:** `{ "objective_id": uuid, "milestone_ids": uuid[] }`
- **Notes:** threaded onto the run (`bd_id`, must be open). A milestone with a `metric_target` is a **key result**; without, a plain milestone. For a sub-OKR, `parent_id` must be a non-abandoned objective in the same project (else `ok:false`). All-or-nothing.

### `objective.query` — read the OKR tree with rolled-up progress
- **Auth:** bearer; agent scoped to `project_id`.
- **Input:** `{ "project_id": string, "objective_id"?: uuid, "include_children"?: boolean (default true) }`
- **Returns:** `{ "objectives": [{ "id", "parent_id", "title", "status", "weight", "progress", "milestones": [{ "id", "title", "status", "metric_target", "metric_current", "metric_direction", "progress" }], "children": [ … ] }] }`
- **Notes:** `progress` ∈ `[0,1]` per ADR-005 (weighted child rollup, ratio-clamp metrics, achieved=1, abandoned children excluded). With `objective_id`, returns that subtree; without, all roots. Project-scoped (RLS + explicit filter).

### `objective.update` — patch a field or transition status
- **Auth:** bearer; agent scoped to `project_id`.
- **Input:** `{ "project_id": string, "objective_id": uuid, "title"?, "description"?, "target_completion"?, "weight"?, "status"?: "active"|"achieved"|"abandoned"|"superseded" }` (≥1 mutable field)
- **Returns:** `{ "objective_id": uuid, "status": string }`
- **Notes:** abandoning here is what later blocks binding — `workflow.create` rejects an abandoned `target_objective_id`.

### `milestone.achieve` — mark a milestone/KR achieved (evidence-gated)
- **Auth:** bearer; agent scoped to `project_id`.
- **Input:** `{ "project_id": string, "bd_id": string, "milestone_id": uuid, "claim": string, "confidence": "low"|"medium"|"high", "evidence_artifact_id"?: uuid }`
- **Returns:** `{ "milestone_id": uuid, "status": "achieved", "objective_id": uuid, "objective_progress": number }`
- **Notes:** **evidence gate** — `confidence ≥ medium` requires an `evidence_artifact_id` in the same project + run (400 if missing; `ok:false` if the cite isn't in this run — covers cross-tenant). Stores an achievement snapshot; achieving an already-achieved milestone → `ok:false`.

### `key_result.update` — move a KR's metric, read back progress
- **Auth:** bearer; agent scoped to `project_id`.
- **Input:** `{ "project_id": string, "milestone_id": uuid, "metric_current": number, "bd_id"?: string }`
- **Returns:** `{ "milestone_id", "metric_current", "metric_target", "metric_direction", "progress", "objective_id", "objective_progress" }`
- **Notes:** target must have a `metric_target` (else `ok:false` — not a KR). Does **not** auto-achieve at 100% (achievement is the explicit, evidence-gated `milestone.achieve`).

```bash
# publish an OKR with one key result, move it to 50%, then achieve it
OBJ=$(curl -s -X POST $API/v1/intent/objective.publish -H "authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d "{\"project_id\":\"project.demo\",\"bd_id\":\"$BD\",\"title\":\"Cut p99 latency\",\"milestones\":[{\"title\":\"p99 ≤ 200ms\",\"metric_target\":200,\"metric_current\":400,\"metric_direction\":\"down\"}]}")
# → { "ok": true, "data": { "objective_id": "…", "milestone_ids": ["…"] } }
curl -s -X POST $API/v1/intent/key_result.update -H "authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d "{\"project_id\":\"project.demo\",\"milestone_id\":\"$MS\",\"metric_current\":300}"
# → { "ok": true, "data": { "progress": 0.66…, "objective_progress": 0.66… } }
curl -s -X POST $API/v1/intent/objective.query -H "authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d "{\"project_id\":\"project.demo\",\"objective_id\":\"$OBJ_ID\"}"
```

### `brief.fetch` — standing instructions targeting this agent + active OKRs
- **Auth:** bearer; agent scoped to `project_id`.
- **Input:** `{ "project_id": string, "include_acked"?: boolean (default false) }`
- **Returns:** `{ "briefs": [{ "id", "title", "body", "target_kind", "target_id", "effective_from", "created_at" }], "active_okrs": [{ "id", "title", "status", "progress", "target_completion" }] }`
- **Notes:** returns briefs targeting the agent's identity (its agent id, team, org, or this project) — isolation enforced by RLS on a `memos.agent_identity` GUC (ADR-006). Superseded briefs and (unless `include_acked`) already-acked briefs are excluded. `active_okrs` are the project's active root objectives with rolled-up progress.

### `brief.ack` — acknowledge a brief
- **Auth:** bearer.
- **Input:** `{ "brief_id": uuid }`
- **Returns:** `{ "brief_id": uuid, "acked": true }`
- **Notes:** idempotent. The brief must be visible to the agent (a brief targeted at someone else → `ok:false` "brief not found"). Acking removes it from the next `brief.fetch` unless `include_acked`.

### `question.ask` — ask the operator (answered back as a brief)
- **Auth:** bearer; agent scoped to `project_id`.
- **Input:** `{ "project_id": string, "bd_id"?: string, "subject"?: string, "body": string, "urgency"?: "low"|"medium"|"high" }`
- **Returns:** `{ "question_id": uuid }`
- **Notes:** scoped to the project; optionally threaded onto an open run (`bd_id`). The answer arrives later as an agent-targeted brief.

### `question.answer` — answer a question (delivers a brief to the asker)
- **Auth:** bearer; agent scoped to `project_id`.
- **Input:** `{ "project_id": string, "question_id": uuid, "answer": string }`
- **Returns:** `{ "question_id": uuid, "brief_id": uuid }`
- **Notes:** marks the question answered and files an `agent`-targeted brief (`title: "Re: <subject>"`, `body: answer`) at the asker. An already-answered question → `ok:false`.

```bash
# fetch briefs + active OKRs
curl -s -X POST $API/v1/intent/brief.fetch -H "authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d '{"project_id":"project.demo"}'
# → { "ok": true, "data": { "briefs": [ … ], "active_okrs": [ … ] } }
```

### `activity.recent` — recent feed items for the dashboard
- **Auth:** bearer; agent scoped to `project_id`.
- **Input:** `{ "project_id": string, "limit"?: number (default 30, max 50) }`
- **Returns:** `{ "activity": [{ "type": "checkin"|"fact"|"learning", "summary": string, "agent_id": string|null, "bd_id": string|null, "created_at": ts }] }`
- **Notes:** the initial page of the live feed — a unified, newest-first view of recent checkins/facts/learnings in one project (RLS + explicit project filter). The live tail then arrives over the SSE stream below.

### `agent.me` — the calling agent's identity + scopes
- **Auth:** bearer.
- **Input:** `{}`
- **Returns:** `{ "agent_id": string, "scopes": string[], "team_id": string|null, "org_id": string|null }`
- **Notes:** lets a client (the dashboard) discover which projects its token can see, without hardcoding.

### `GET /v1/stream/activity` — live activity stream (SSE, not an intent)
- **Auth:** `Authorization: Bearer …`; agent scoped to the `project_id` query param.
- **Query:** `?project_id=<id>`
- **Returns:** an `text/event-stream` of `event: activity` frames (`data` = the activity event JSON: `{ type, projectId, agentId, summary, ts, bdId }`), plus a `ready` frame on connect and `ping` heartbeats. Write intents publish to an in-process bus **after commit**, so the stream reflects only durable writes (ADR-007).

```bash
curl -N -H "authorization: Bearer $TOK" "$API/v1/stream/activity?project_id=project.demo"
# event: ready
# data: {"project_id":"project.demo"}
# event: activity
# data: {"type":"fact","summary":"p99 dropped…","agentId":"agent.x","ts":"…"}
```

### Governance workers (not intents)
Run on demand from the `@memos/workers` package (the logic lives in `@memos/api/governance`):
- `pnpm --filter @memos/workers run critic:evidence` — files a brief at any agent with a medium/high fact or learning that lacks evidence (the evidence-gate compliance critic).
- `pnpm --filter @memos/workers run briefs:escalate` — escalates agent briefs unacked for >24h to the agent's team.

*More intents are added per phase (feedback.submit, choice.log, … ) — see `docs/PHASED_BUILD_PLAN.md`.*

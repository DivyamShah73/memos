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

*More intents are added per phase (objective.*, milestone.achieve, brief.*, question.*, … ) — see
`docs/PHASED_BUILD_PLAN.md`.*

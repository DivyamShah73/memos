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

*More intents are added per phase (artifact.upload, fact.record, learning.record, … ) — see
`docs/PHASED_BUILD_PLAN.md`.*

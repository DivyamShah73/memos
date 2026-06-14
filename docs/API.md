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

*More intents are added per phase (workflow.create, checkin, fact.record, … ) — see
`docs/PHASED_BUILD_PLAN.md`.*

# 011. Per-user dashboard auth: user-session tokens, one principal shape

- **Status:** accepted
- **Date:** 2026-06-24
- **Deciders:** Divyam Shah

## Context

ADR-007 made the dashboard read through the gateway as one shared **operator agent** (single password, one token). Phase 13 makes the dashboard **multi-user**: each person logs in as themselves and sees only what their role + memberships allow (a CEO sees the whole org read-only; a manager their team; a member their project). That requires the gateway to authenticate a *human* — but the gateway only knew agent bearer tokens, and a human's role/scope live in `memberships`, not on an agent row.

## Decision

**Humans authenticate with a session bearer token, resolved to the same principal shape as an agent** — so the entire dispatch pipeline (org/project GUC, the Phase-12 authz guard) stays uniform.

- **`user.login`** (public intent): verifies email + password (scrypt), mints a 256-bit session token, stores its **SHA-256 hash** on `users.session_token_hash` (a random secret, so by-hash lookup like agent tokens — not a password KDF), and returns `{ api_token, user_id, org_id, display_name, role, projects }`.
- **Gateway auth** tries `resolveAgent` (agents, by token hash) and falls back to **`resolveUserPrincipal`** (users, by `session_token_hash`, owner connection — a by-credential lookup before the org GUC exists, like agent auth). A user principal is `{ id: userId, orgId, role: highest membership role, scopes: resolveUserScope.projects }`. The two paths produce one `AuthedAgent` shape; everything downstream is unchanged.
- **The dashboard calls the gateway AS the logged-in user**: the login server action stores the token in the signed, httpOnly session cookie (`session.ts` now carries the token, not `operator:<ts>`); `callIntent` and the SSE proxy read that token instead of a shared `MEMOS_OPERATOR_TOKEN`. A **project switcher** (the user's `scopes`) sets the selected project; `getProjectId()` reads it.
- A user's **effective role** is the highest of their memberships (ceo > manager > member) — sufficient for the dashboard; per-(user,project) role resolution is deferred.

## Alternatives considered

- **Keep the shared operator token; map users client-side.** Rejected: bypasses the gateway's own authz/RLS and can't express per-user scope — defeats the point.
- **A separate `user_sessions` table.** Cleaner for multi-session + expiry, but heavier; a single `session_token_hash` per user (re-login rotates) is enough for the demo. Revisit for concurrent sessions / token TTL.
- **JWTs.** Unnecessary: the gateway already does fast by-hash bearer lookups; a stored opaque token reuses that path and is trivially revocable (null the hash).

## Consequences

- **Positive:** one auth pipeline for agents and humans; the dashboard is genuinely per-user (role + scope enforced at the gateway, not the UI); ADR-007's shared-operator model is retired; logout = clear the cookie, revoke = null the hash.
- **Negative / tradeoffs:** user-principal writes set author/agent id columns to a user uuid — fine for the steering writes a user actually performs (objectives/briefs have no agent FK), but agent-FK'd writes (fact/learning/workflow) are not exposed to users and would FK if ever called by one. One session per user (re-login rotates the token). The dashboard sidebar shows the user's org/scope rather than a friendly name (agent.me returns the principal id); a nicety, not load-bearing.

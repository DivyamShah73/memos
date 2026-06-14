# 003. Agent auth: SHA-256-hashed opaque bearer tokens + single-use enrollment codes

- **Status:** accepted
- **Date:** 2026-06-15
- **Deciders:** Divyam Shah

## Context

Agents authenticate on every intent call (except `agent.enroll`). We need a token scheme that is (a) revocable, (b) safe if the database leaks, (c) cheap to verify on every request (auth is on the hot path of a stateless gateway), and (d) simple to issue with no secret-rotation dance. Tokens are machine-held, not human-typed.

## Decision

- **Enrollment:** the operator mints a single-use `enr_code_…`. `agent.enroll` (the one unauthenticated intent) exchanges it for a permanent token. Single-use is enforced by an **atomic compare-and-swap** — `UPDATE enrollment_codes SET used_by=:agent, used_at=now() WHERE code=:code AND used_by IS NULL RETURNING …`, with the agent INSERT in the **same transaction** — not by the pre-check SELECT (which only improves the error message). The loser of a race matches 0 rows and is rejected.
- **Token:** `syn_` + base64url(32 random bytes) = 256 bits of entropy. Shown to the agent **once**.
- **Storage:** only `sha256(raw)` (lowercase hex) is stored in `agents.api_token_hash`. Per request the gateway hashes the presented bearer and looks the agent up by hash, filtered `AND status='active'` in SQL so a revoked agent's row never returns.

## Alternatives considered

- **bcrypt / argon2 hashing.** Rejected: these are deliberately *slow* to defend *low-entropy* human passwords against offline brute-force. Our tokens carry 256 bits of entropy — brute-forcing a preimage is infeasible regardless of hash speed — so a slow hash buys no security and adds latency to every authenticated request. A fast SHA-256 is the correct tool (the same pattern GitHub PATs and Stripe keys use). Also, bcrypt's per-hash salt would prevent the direct `WHERE api_token_hash = :hash` index lookup, forcing a scan.
- **Storing tokens in plaintext / reversible encryption.** Rejected: a DB leak would expose every live token. Hashing means a leak yields only useless digests.
- **Stateless signed tokens (JWT/PASETO).** Rejected for now: revocation needs a denylist (re-introducing state), and we already have a DB lookup for the agent's scopes/trust on every call — an opaque token that *is* the lookup key is simpler and revocation is just `status='revoked'`.

## Consequences

- **Positive:** O(1) indexed auth lookup; DB leak exposes no usable tokens; revocation is immediate (`status` flip); issuance is a single code redemption with no rotation.
- **Negative / tradeoffs:** lost tokens can't be recovered (by design — re-enroll). The hash is unsalted, which is fine for high-entropy inputs but means identical tokens hash identically — a non-issue since tokens are unique random values. A future hardening could HMAC the token with a server-side pepper so a DB leak alone can't confirm a guessed token; deferred (256-bit entropy already makes guessing infeasible).
- **Hot-path note:** never log the `Authorization` header or the `agent.enroll` response body (it carries `api_token.raw`).
- **Forward note (Phase 2):** the gateway connects as the non-owner `memos_app` role (ADR-002). The moment an intent reads/writes an RLS-protected table, the handler must set `memos.agent_projects` for the request (`SET LOCAL` inside a transaction) from the agent's `scopes`, or RLS default-denies every row. Phase 1 only touches the un-RLS'd control-plane tables, so no GUC is set yet.

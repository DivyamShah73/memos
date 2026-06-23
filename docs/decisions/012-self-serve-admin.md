# 012. Self-serve admin & lifecycle

- **Status:** accepted
- **Date:** 2026-06-24
- **Deciders:** Divyam Shah

## Context

Phases 11–13 made MemOS multi-org, role-aware, and per-user — but onboarding still meant running SQL: orgs, users, and agent codes were created by the seed or by hand. To be a product a customer can actually run, the org lifecycle has to be **self-serve**: sign up, invite people, issue agent tokens, and offboard — all through the gateway, gated by role.

## Decision

Five intents, gated by the Phase-12 authz matrix, with every mutating action **org-ownership-checked** and **audit-logged**:

- **`org.signup`** (public) — the front door. Creates an org + starter team/project + first **CEO** (via `provisionOrg`) and returns a ready session token. Public like `agent.enroll`.
- **`enrollment.create`** (manager/CEO) — mint a single-use agent enrollment code for a project **in the actor's scope** (so a manager can only issue codes for their own projects; a CEO for any in the org).
- **`user.invite`** (manager/CEO) — create a user + one membership in the actor's org (a project-scoped invite must be in the actor's scope).
- **`agent.revoke`** / **`member.offboard`** (manager/CEO) — lifecycle: revoke an agent (its token stops resolving) / disable a user and null its session (login dies immediately).

Two model decisions:
- **Org administration is its own capability tier** (`ADMIN_INTENTS` in `authz.ts`), allowed for **manager OR ceo** and *not* subject to the CEO read-only rule. The CEO runs the org (invites, offboards) even though it can't author project *content* — otherwise a freshly-signed-up org's only member could do nothing.
- **An `audit_log`** (org-RLS'd) records every admin/steering action for accountability. Records are written via the **owner connection** (`recordAudit`) so they work for the public `org.signup` (no org GUC yet) and never fail the action they log; reads are org-scoped via `memos_app`.

Cross-org safety: each handler verifies the target (project/agent/user) belongs to the actor's org before acting — administration can never reach across orgs.

## Alternatives considered

- **CEO-only admin.** Rejected: managers must run their own teams (issue codes, invite) without bouncing to the CEO.
- **A generic `admin.*` intent with an action param.** Rejected: distinct intents keep per-action Zod schemas + the authz matrix legible and individually testable.
- **Cascade offboarding to "the user's agents".** Deferred: agents aren't linked to a user (no `agents.user_id`); offboard disables the *user's* login, and `agent.revoke` handles agents by id. A user↔agent ownership link is a future refinement.
- **Audit via memos_app under RLS.** Rejected for writes: `org.signup` has no org GUC; owner-write + RLS-read is simpler and matches the governance-worker pattern.

## Consequences

- **Positive:** a customer onboards with zero operator intervention (signup → invite → mint codes → work); lifecycle (revoke/offboard) is immediate; every admin action is attributable; the whole loop is proven by `phase14.sh` + `admin.test.ts`.
- **Negative / tradeoffs:** admin writes use the owner connection (org ownership enforced in-handler rather than by RLS — covered by tests); `org.signup` is unauthenticated, so it's a spam/abuse surface a real product would rate-limit/CAPTCHA (out of scope for the demo); offboarding doesn't yet cascade to a user's agents (no ownership link).

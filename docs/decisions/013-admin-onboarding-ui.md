# 013. Self-serve admin & onboarding UI

- **Status:** accepted
- **Date:** 2026-06-24
- **Deciders:** Divyam Shah

## Context

Phase 14 made the org lifecycle self-serve at the **API** — but only at the API. An org was still born
via `org.signup` over curl, members were invited via raw intent calls, and the dashboard sidebar said
*"Members soon."* For MemOS to be a product a non-engineer can run, administration has to live in the
**dashboard**. Two concrete gaps blocked that: there were **no read intents** to list an org's members
or agents (Phase 14 is write-only, so an admin page had nothing to display), and `agent.me` did not
return the caller's **role**, so the UI couldn't decide whether to show admin surfaces.

## Decision

Add the **UI surfaces** plus the **minimum read API** they need — no new tables (the Phase-11 data
model already supports it).

- **Two read intents, manager/CEO only** (added to the existing `ADMIN_INTENTS` authz tier, so the
  read side shares the write side's role rule and is *not* blocked by the CEO read-only rule):
  - **`member.list`** — the org's users with their memberships (role + scope). Reads the org-RLS'd
    `users`/`memberships` through `withScope` (the `memos.org_id` GUC bounds it to the caller's org at
    the DB — isolation is not a handler concern).
  - **`agent.list`** — the org's agents (id, role, status, scopes, trust, last-seen). `agents` is
    control-plane (no RLS — it's read by-token during auth), so this filters **in-handler by
    `org_id`**, exactly like `trust.leaderboard`; an org-isolation test guards the filter.
- **`agent.me` now returns `role`** so the dashboard can gate admin surfaces (the principal already
  carried it since Phase 12).
- **Public signup page** (`/signup`) — anyone can create an org and become its CEO; mirrors the login
  page's cookie handling. The login page links to it; middleware treats `/signup` like `/login`.
- **Admin page** (`/admin`) — role-gated (manager/CEO; members get a not-authorized panel). Lists
  members + agents and drives the Phase-14 write intents: invite (`user.invite`), offboard
  (`member.offboard`), revoke (`agent.revoke`), and mint enrollment codes (`enrollment.create`). The
  invite role dropdown offers only roles ≤ the actor's (matching the API's no-escalation rule). Code
  minting goes through a small route handler (`/api/admin/enroll`) + client component so the one-time
  code can be shown and copied (a server action can't return a value to render).

## Alternatives considered

- **A generic `member.list` that also lists agents.** Rejected: agents and humans live in different
  tables with different isolation models (control-plane vs org-RLS) — two intents keep each handler's
  scoping explicit and individually testable.
- **Surface the minted code via a server action + `redirect("/admin?code=…")`.** Rejected: puts a
  (single-use, secret-ish) enrollment code in the URL/history; a client fetch to a route handler keeps
  it in the response body only.
- **Invite-only onboarding (no public signup).** Considered; the product goal is self-serve, so a
  public `/signup` was chosen. Abuse is bounded by the existing per-IP rate limiter on `org.signup`.
- **Finer per-team member scoping for managers.** Deferred: for the demo a manager sees all members in
  their org (org-RLS still bounds it to the org); per-team filtering is a later refinement.

## Consequences

- **Positive:** the full lifecycle is now usable without curl — sign up, invite, mint codes,
  revoke/offboard — all role-gated in the dashboard. The read intents are org-isolated at the DB
  (`member.list`) or by an in-handler filter (`agent.list`), both covered by tests; `phase15.sh` proves
  the read side over HTTP and `admin.spec.ts` proves the UI.
- **Negative / tradeoffs:** `/signup` is a public, unauthenticated surface on the live demo (rate-limited
  only); invites set an **initial password** rather than emailing a link (no mail service in the demo);
  managers see all org members, not just their team's. No new migrations.

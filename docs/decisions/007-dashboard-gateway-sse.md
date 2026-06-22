# 007. Dashboard reads through the gateway; live feed via an in-process SSE bus

- **Status:** accepted
- **Date:** 2026-06-23
- **Deciders:** Divyam Shah

## Context

Phase 7 adds the operator dashboard (Next.js). The original build plan sketched "Supabase Auth + Realtime + RLS-via-`auth.uid()`", but the actual stack is plain Postgres + MinIO + Redis (no Supabase), and the only identity in the data model is `agents` (no operator/users table). Two questions had to be answered: (1) how does the dashboard read tenant-isolated data, and (2) how does the live activity feed update without a refresh.

## Decision

**Reads go through the existing intent gateway, not the database directly.** The Next.js *server* (server components + route handlers) calls the gateway's intents (`objective.query`, `activity.recent`, `agent.me`, …) as a seeded **operator agent** — an ordinary `agents` row scoped to `project.demo`, whose token lives only in a non-`NEXT_PUBLIC_` env var (`MEMOS_OPERATOR_TOKEN`). The browser only ever talks to the Next.js server, so the token never ships to the client. This means the dashboard is subject to the *same* RLS + evidence rules as any agent — the isolation work (ADR-002/004/006) is reused verbatim, and there is one source of truth (the gateway, ADR-001) instead of a second DB access path.

**Operator login is a lightweight signed-cookie gate** (`DEMO_PASSWORD` + an HMAC-signed cookie via `SESSION_SECRET`), not real IdP auth — explicitly a portfolio demo gate. Middleware does a cheap cookie-presence check (edge runtime, no `node:crypto`); the signature is verified in the dashboard layout (Node runtime).

**The live feed is Server-Sent Events from the gateway, fed by an in-process event bus.** `core/events.ts` is a Node `EventEmitter`; the write handlers (`checkin`, `fact.record`, `learning.record`, `milestone.achieve`) `publishActivity(...)` **after their transaction commits** (so the feed never shows a rolled-back write). A `GET /v1/stream/activity` route authenticates by bearer, checks project scope, subscribes to the bus, and streams `text/event-stream` frames for that project (15s heartbeat, unsubscribe on disconnect). The browser's `EventSource` connects to a Next.js route handler (`/api/stream`) that opens the gateway stream with the operator token and pipes it through — keeping the token server-side.

## Alternatives considered

- **Supabase Auth + Realtime + direct DB reads (`auth.uid()` RLS).** Rejected for this stack/timeline: it needs a hosted Supabase project, a parallel auth + RLS model, and bypasses the gateway — more setup and a second isolation mechanism to keep correct, on a tight deadline. (Reinforcing "Supabase" on a résumé didn't outweigh reusing the stronger gateway/RLS story.)
- **Polling `activity.recent` every ~1s** instead of SSE. Rejected as the default (kept as the trivial fallback): it works but is less impressive for the demo and wastes round-trips; SSE is true push and, on a single gateway process, costs only an in-memory emitter.
- **Redis pub/sub or Postgres LISTEN/NOTIFY** for the event fan-out. Deferred: correct for a multi-instance deploy, but the gateway is a single process here, so an in-memory `EventEmitter` is simpler and sufficient. The publish/subscribe seam (`publishActivity`/`subscribeActivity`) is isolated, so swapping the transport later is a localized change.

## Consequences

- **Positive:** one isolation mechanism (RLS via the gateway) covers agents *and* the dashboard; the operator token never reaches the browser; true real-time feed with no extra infrastructure; the dashboard is just another gateway client, so every future intent is instantly usable in the UI.
- **Negative / tradeoffs:** the in-memory bus doesn't survive a gateway restart and doesn't fan out across multiple gateway instances (documented; LISTEN/NOTIFY or Redis is the upgrade path). The demo login is a single shared credential, not per-user auth — fine for a portfolio console, not for production. SSE through the Next proxy needs explicit no-buffering headers (`Cache-Control: no-transform`, `X-Accel-Buffering: no`) to flush frames promptly.

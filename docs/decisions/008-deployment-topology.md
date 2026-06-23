# 008. Deployment topology: persistent-process API, self-provisioning image, free tier

- **Status:** accepted
- **Date:** 2026-06-23
- **Deciders:** Divyam Shah

## Context

MemOS was feature-complete (Phases 0–9) but ran only locally: `docker-compose` for Postgres/MinIO/Redis, a repo-root `.env`, and `tsx`/`next dev`. To make the resume's GitHub link point at a live dashboard, it needed a **free, low-maintenance** hosted deployment. Several properties of the codebase constrain how that can be done:

- **No build step.** `@memos/shared` exports raw `./src/index.ts`; the api/sdk/workers packages run under `tsx` (NodeNext ESM, see `tsconfig.base.json`). There is no bundler and no `dist/`.
- **The live activity feed is SSE** (`GET /v1/stream/activity`, a long-lived connection driven by an in-process `EventEmitter`). A request/response serverless function cannot hold that stream open.
- **Two DB roles** (ADR-002): migrations/seed run as the owner (`DATABASE_URL`); the gateway connects as the non-owner `memos_app` (`MEMOS_APP_DATABASE_URL`) so RLS applies. The role + `vector`/`pgcrypto` extensions are created by `0000_prereqs.sql` at migrate time.
- **The hosted demo needs Postgres only.** `db/seed.ts` writes artifact *rows* directly (no `putObject`); `app.ts` builds the DB client lazily and touches no MinIO/Redis at boot; the rate limiter is an in-process Map (the compose `redis` service is a dead stub). The S3 blob store is exercised only by the live `artifact.upload` intent.
- **No CORS surface.** The dashboard calls the gateway server-side only (operator token held in a non-`NEXT_PUBLIC_` env var), so the browser never makes a cross-origin call to the API.

## Decision

**Topology:** Postgres+pgvector on **Neon** (free, no expiry); the **API on Render** as a free **Docker web service** (a persistent Node process, so SSE works); the **dashboard on Vercel** (Hobby); the governance critic and CI on **GitHub Actions**. The blob store is an **optional add-on** (R2 / Supabase Storage), not required for the demo.

**The image self-provisions.** `infra/deploy/Dockerfile` installs the workspace (skipping `@memos/web`'s deps via `--filter=!@memos/web`; `tsx` comes from the root dev-deps) and runs `tsx` directly — no compile. `infra/deploy/docker-entrypoint.sh` runs, in order: `migrate` (owner) → `seed` (owner, idempotent) → `serve` (`memos_app`). Both migrate and seed are idempotent, so a fresh Neon database comes up fully provisioned on first boot and every redeploy is safe. `server.ts` now honors the platform-injected `PORT` (falling back to `MEMOS_PORT`, then `8787`).

**Config is env-only and declarative.** `infra/deploy/render.yaml` is a Blueprint with three `sync: false` secrets (`DATABASE_URL`, `MEMOS_APP_DATABASE_URL`, `MEMOS_OPERATOR_TOKEN`); Vercel takes the API URL + the *same* operator token + session secrets. The shared `MEMOS_OPERATOR_TOKEN` is the one cross-service coupling (it seeds the operator agent the dashboard authenticates as). `docs/DEPLOY.md` is the click-by-click; `.github/workflows/ci.yml` green-gates every push, `critic.yml` runs the critic on a schedule.

## Alternatives considered

- **API on Vercel/Cloudflare serverless functions.** Rejected: kills the SSE feed (no long-lived connection), the in-process rate-limiter Map and event bus don't survive across invocations, and `postgres-js` (raw TCP) doesn't fit the Workers runtime without a rewrite to an HTTP driver.
- **Bundle the API (tsup/esbuild) into a `dist/` and run plain `node`.** Rejected for now: adds a build step and a new failure mode for zero runtime benefit — `tsx` is exactly how the repo runs everywhere else. Recorded as out-of-scope, not wrong.
- **Supabase all-in (DB + bundled Storage).** Viable, but its connection pooler + custom-role (`memos_app`) story is fiddlier than Neon's, and the demo needs no blob store — so Neon (clean two-role connection strings) + an optional blob add-on is simpler.
- **Render free managed Postgres.** Rejected: free Postgres expires and pgvector availability is less certain than Neon's; Neon free has no expiry and allow-lists `vector`.
- **Migrate/seed as a separate Render job or manual step.** Rejected in favor of a self-provisioning entrypoint — fewer manual steps (the whole point), and idempotency makes run-on-every-boot safe.

## Consequences

- **Positive:** a fresh deploy is ~click-Blueprint + paste-secrets; the DB self-provisions; redeploys are idempotent; CI keeps the repo green hands-off; the critic runs without an always-on worker; no code rewrite (tsx in prod mirrors local).
- **Negative / tradeoffs:** Render free **sleeps after ~15 min idle** (first hit ~50s cold start); SSE proxied through Vercel's Node function has a max duration, so `EventSource` periodically auto-reconnects (the feed stays live). `memos_app` ships with the password from `0000_prereqs.sql` — acceptable behind Neon's authenticated TLS endpoint; `DEPLOY.md` documents an optional `ALTER ROLE` hardening. Running `tsx` in prod keeps dev-deps in the image (larger than a bundled artifact). Live `artifact.upload` needs the optional blob store configured; without it, that one intent 500s while everything else works.

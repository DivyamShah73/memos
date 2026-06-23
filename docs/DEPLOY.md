# Deploying MemOS (free tier)

A live MemOS is three free services — **Neon** (Postgres), **Render** (the API gateway), **Vercel**
(the dashboard) — plus GitHub Actions for CI and the governance critic. Total cost: $0. Hands-on
time: ~10 minutes, almost all of it pasting secrets. Everything else (schema migration, demo seed,
serving) happens automatically on the API's first boot.

```
 Browser ──▶ Vercel (Next.js dashboard) ──serverside──▶ Render (Hono API) ──▶ Neon (Postgres + RLS)
                                                              ▲
                                              GitHub Actions ─┘  (CI on push · critic on a schedule)
```

> **Why this shape:** the API is a *persistent process*, not serverless, because the dashboard's
> live feed is Server-Sent Events (a long-lived connection). See `docs/decisions/008`.

---

## 0. Prerequisites

- The repo on GitHub (public is fine): `https://github.com/DivyamShah73/memos`.
- Free accounts: [neon.tech](https://neon.tech), [render.com](https://render.com),
  [vercel.com](https://vercel.com) — sign in to each with GitHub.
- One secret you generate now and reuse twice — the **operator token**. Any long random string,
  prefixed `syn_`. For example:
  ```bash
  echo "syn_$(openssl rand -hex 24)"
  ```
  Keep it handy; it goes into **both** Render and Vercel below.

---

## 1. Neon — the database

1. Create a new project (any name/region). Neon gives you a Postgres 16 instance with `pgvector`
   available — that's all MemOS needs.
2. From **Connection Details**, copy the connection string. Use the **direct** connection (not the
   `-pooler` host) and make sure it ends with `?sslmode=require`. It looks like:
   ```
   postgresql://neondb_owner:<PWD>@ep-xxxx.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
   This is your **`DATABASE_URL`** (the owner connection — used for migrations + seed).
3. Derive the **app** connection by swapping the user/password to `memos_app` / `memos_app`
   (same host + database). This is **`MEMOS_APP_DATABASE_URL`**:
   ```
   postgresql://memos_app:memos_app@ep-xxxx.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
   You don't create that role yourself — the first migration (`0000_prereqs.sql`) creates the
   `memos_app` role and the `vector`/`pgcrypto` extensions automatically when the API boots.

> **Hardening (optional):** the `memos_app` role ships with a default password. To change it, after
> the first deploy run `ALTER ROLE memos_app PASSWORD '<new>';` in Neon's SQL editor and update the
> password in `MEMOS_APP_DATABASE_URL` on Render.

---

## 2. Render — the API gateway

1. **New → Blueprint**, connect the repo. Render reads `infra/deploy/render.yaml` and proposes a
   free Docker web service named `memos-api`.
2. It will prompt for the three secrets (marked `sync: false`). Paste:
   - `DATABASE_URL` — the Neon **owner** string from step 1.2
   - `MEMOS_APP_DATABASE_URL` — the **app** string from step 1.3
   - `MEMOS_OPERATOR_TOKEN` — the `syn_…` token you generated in step 0
3. **Apply / Create**. On first boot the container runs **migrate → seed → serve** automatically
   (watch the logs: `applying migrations…`, `seeding demo data…`, `starting gateway…`).
4. When it's live, note the URL (e.g. `https://memos-api.onrender.com`) and check:
   ```
   https://memos-api.onrender.com/health   →   {"ok":true,"data":{"status":"healthy"}}
   ```

> **Free-tier note:** the service sleeps after ~15 min idle, so the first request after a quiet
> spell takes ~50s to wake. Fine for a portfolio demo. To keep it warm, point a free pinger
> (e.g. cron-job.org / UptimeRobot) at `/health` every 10 minutes.

---

## 3. Vercel — the dashboard

1. **Add New → Project**, import the repo.
2. **Set Root Directory to `packages/web`.** (Vercel still installs from the workspace root, so the
   `@memos/shared` dependency resolves — pnpm workspaces are auto-detected.) Framework auto-detects
   as Next.js.
3. Add Environment Variables (Production):
   | Name | Value |
   |---|---|
   | `MEMOS_API_URL` | your Render URL, e.g. `https://memos-api.onrender.com` |
   | `MEMOS_OPERATOR_TOKEN` | the **same** `syn_…` token you put in Render |
   | `MEMOS_PROJECT_ID` | `project.demo` |
   | `SESSION_SECRET` | any long random string (signs the login cookie) |
   | `DEMO_PASSWORD` | the dashboard login password you want |
4. **Deploy.** Open the URL, log in with `DEMO_PASSWORD`, and you should see the seeded OKR tree,
   the live activity feed, the provenance graph, and briefs.

> The operator token is read server-side only (no `NEXT_PUBLIC_` prefix), so it never reaches the
> browser — the dashboard calls the gateway for you (ADR-007).

---

## 4. GitHub Actions (already in the repo)

- **`.github/workflows/ci.yml`** runs on every push/PR: it brings up the compose stack, migrates,
  typechecks, runs the API test suite, and builds the dashboard. Zero setup.
- **`.github/workflows/critic.yml`** runs the evidence-compliance critic on a schedule. One-time
  setup: add a repo secret **`DATABASE_URL`** (the Neon owner string) under
  *Settings → Secrets and variables → Actions*. You can also trigger it manually (Run workflow).

---

## 5. Verify end-to-end

1. `GET <render-url>/health` → healthy.
2. Dashboard loads, login works, OKRs + feed + provenance + briefs render.
3. In the dashboard, author a brief (or post a fact via the API) and watch it appear in the live
   feed within ~1s — that proves the SSE path through Vercel → Render is working.

---

## Optional: blob store (live `artifact.upload`)

The demo needs none — the seed writes artifact *metadata* rows directly, and every page works
without object storage. Configure a blob store only if you want the live `artifact.upload` intent
(uploading evidence bytes) to work. Any S3-compatible store does; add these env vars on **Render**:

| Name | Value |
|---|---|
| `MINIO_ENDPOINT` | the S3 endpoint URL (e.g. Cloudflare R2 / Supabase Storage) |
| `MINIO_ROOT_USER` | access key id |
| `MINIO_ROOT_PASSWORD` | secret access key |
| `MINIO_BUCKET` | bucket name (e.g. `memos-artifacts`) |
| `MINIO_REGION` | region (e.g. `auto` for R2, `us-east-1` otherwise) |

`services/blobstore.ts` uses path-style S3 and creates the bucket lazily on first upload.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Render build fails on `pnpm install` | The lockfile must match — deploy from a clean `main`; don't hand-edit `pnpm-lock.yaml`. |
| `/health` ok but dashboard 500s | `MEMOS_API_URL` wrong, or `MEMOS_OPERATOR_TOKEN` differs between Render and Vercel — they must be identical. |
| Login fails | `DEMO_PASSWORD` / `SESSION_SECRET` not set on Vercel. |
| Migrations error on `CREATE ROLE` | A provider that forbids role creation — create `memos_app` once in the SQL console, then redeploy. |
| Feed not updating | Render woke from sleep (first event after idle lags), or the SSE proxy reconnected — refresh; it resumes. |
| `artifact.upload` 500s | The optional blob store isn't configured (see above). Everything else is unaffected. |
| Dashboard 401s after **changing** `MEMOS_OPERATOR_TOKEN` | The seed creates the operator agent with `onConflictDoNothing`, so a redeploy with a *new* token does **not** overwrite the stored hash. To rotate: update the `agent.operator` row's `api_token_hash` to `sha256(<new token>)` in Neon's SQL editor, then set the new token in both Render and Vercel. |

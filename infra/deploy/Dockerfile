# MemOS API gateway — production image.
#
# The repo has no build step on purpose: @memos/shared exports raw TypeScript and every Node
# package runs under tsx (see tsconfig.base.json). So this image just installs the workspace and
# runs tsx — there is nothing to compile. The entrypoint self-provisions the database (migrate +
# seed, both idempotent) and then serves, so a fresh managed Postgres comes up ready on first boot.
#
# Build context is the REPO ROOT (render.yaml sets dockerContext: .). Built + smoke-tested locally
# by testing/phase10.sh against the docker-compose Postgres before it ever reaches the cloud.
FROM node:20-slim

# tini as PID 1 → clean SIGTERM forwarding when the platform recycles the container.
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# --- deps layer (cached until a manifest or the lockfile changes) ---
# Copy every workspace manifest so pnpm can resolve the workspace graph + validate the lockfile,
# then install. We skip @memos/web's heavy deps (next/react/xyflow) — the gateway image never
# serves the dashboard (that's Vercel's job). tsx itself is a root devDependency and the `!web`
# filter keeps the root project selected, so tsx is present at runtime.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/api/package.json packages/api/
COPY packages/shared/package.json packages/shared/
COPY packages/workers/package.json packages/workers/
COPY packages/web/package.json packages/web/
COPY sdk/memos-agent/package.json sdk/memos-agent/
RUN pnpm install --frozen-lockfile --filter=!@memos/web

# --- source layer ---
# env.ts resolves repoRoot to /app, so migrate reads /app/infra/migrations and dotenv looks for
# /app/.env (absent in prod → no-op; config comes from the platform's injected env vars).
COPY packages ./packages
COPY sdk ./sdk
COPY infra ./infra

RUN chmod +x infra/deploy/docker-entrypoint.sh

ENV NODE_ENV=production
# pnpm puts workspace binaries (tsx) in the root node_modules/.bin — put it on PATH so the
# entrypoint can call `tsx` directly (and signals reach node cleanly via tini → tsx → node).
ENV PATH="/app/node_modules/.bin:${PATH}"
# PORT is injected by the platform (Render/Fly/…); server.ts honors it. No EXPOSE needed.
ENTRYPOINT ["tini", "--", "infra/deploy/docker-entrypoint.sh"]

import { fileURLToPath } from "node:url";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs this config with cwd = packages/api; load the repo-root .env so
// DATABASE_URL resolves (the single source-of-truth .env lives at the repo root).
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, "../../.env") });

// Generate-only workflow: we run `drizzle-kit generate` to author migration SQL, and
// apply it with our own programmatic migrator (src/db/migrate.ts). We never run
// `drizzle-kit push` — push would try to reconcile the pgvector extension and the
// memos_app role, which it didn't author and can't create in the right order.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  // Resolves to the repo-root infra/migrations (relative to packages/api).
  out: "../../infra/migrations",
  dbCredentials: {
    // Owner/superuser connection — drizzle-kit only runs at dev time for diffing.
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});

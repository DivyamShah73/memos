/**
 * Programmatic migration runner — `pnpm db:migrate`.
 *
 * Runs as the Postgres OWNER (DATABASE_URL), which is what we want: migrations do DDL
 * (CREATE EXTENSION, tables, RLS policies, GRANTs to memos_app). We use a hand-rolled
 * migrator rather than `drizzle-kit migrate` so role identity is explicit — RLS only
 * means something because the *gateway* (Phase 1) connects as the non-owner memos_app,
 * while migrations connect as owner here.
 *
 * Applies every migration in infra/migrations in journal order (0000 → 0001 → 0002).
 */
import path from "node:path";
import { repoRoot } from "../env.js"; // side effect: loads the repo-root .env
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const migrationsFolder = path.join(repoRoot, "infra", "migrations");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
  process.exit(1);
}

async function run(): Promise<void> {
  // `up -d` followed immediately by db:migrate can race first-boot Postgres even after
  // the healthcheck flips; retry the initial connection a few times.
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const client = postgres(url!, { max: 1, onnotice: () => {} });
    try {
      await migrate(drizzle(client), { migrationsFolder });
      await client.end({ timeout: 5 });
      console.log("Migrations applied successfully.");
      return;
    } catch (err) {
      await client.end({ timeout: 5 }).catch(() => {});
      const isLast = attempt === maxAttempts;
      console.warn(
        `Migration attempt ${attempt}/${maxAttempts} failed: ${(err as Error).message}`,
      );
      if (isLast) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

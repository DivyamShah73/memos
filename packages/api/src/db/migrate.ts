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

// Only a *transient* failure should be retried (e.g. `up -d` then immediate db:migrate
// racing first-boot Postgres, or a just-restarted DB replaying WAL in recovery mode). A
// real SQL/DDL error is deterministic — retrying it 5× just buries the message, so fail
// fast on those. Covers Node socket errors, Postgres class-08 connection exceptions, and
// 57P03 (cannot_connect_now / server starting up / in recovery).
const RETRYABLE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "57P03", // cannot_connect_now (server in recovery / still starting)
  "08000", // connection_exception
  "08006", // connection_failure
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08004", // sqlserver_rejected_establishment_of_sqlconnection
]);

async function run(): Promise<void> {
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
      const code = (err as { code?: string }).code;
      const retryable = code !== undefined && RETRYABLE_CODES.has(code);
      if (attempt === maxAttempts || !retryable) throw err; // surface the real error
      console.warn(`DB not ready (attempt ${attempt}/${maxAttempts}: ${code}); retrying...`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

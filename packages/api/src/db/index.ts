/**
 * Drizzle database client.
 *
 * Phase 0 exposes an OWNER-connected client (DATABASE_URL) so the package compiles and
 * tooling has a handle. From Phase 1, the gateway will instead connect as the
 * least-privileged memos_app role (MEMOS_APP_DATABASE_URL) and set the per-request
 * `memos.agent_projects` GUC so RLS policies apply — see docs/decisions/002.
 */
import "../env.js"; // side effect: loads the repo-root .env
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

const url = process.env.DATABASE_URL ?? "";

// Lazily created so importing this module never throws when env is unset (e.g. typecheck).
export const queryClient = postgres(url, { max: 10, onnotice: () => {} });
export const db = drizzle(queryClient, { schema });

export { schema };

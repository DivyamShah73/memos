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

// postgres-js connects lazily (on first query), so constructing the client at import is
// side-effect-free and won't throw when env is unset (e.g. during typecheck). If
// DATABASE_URL is missing, the failure surfaces at the first query, not here.
export const queryClient = postgres(url, { max: 10, onnotice: () => {} });
export const db = drizzle(queryClient, { schema });

export { schema };

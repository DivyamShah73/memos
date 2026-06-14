/**
 * Gateway DB client — connects as the least-privileged `memos_app` role
 * (MEMOS_APP_DATABASE_URL), NOT the owner. This is the connection the intent handlers
 * use, so Row-Level Security policies apply to every tenant query (ADR-002).
 *
 * The owner client in db/index.ts is for migrations/seed/test-fixtures only; never use
 * it from a handler. Phase 1 only touches the un-RLS'd control-plane tables
 * (agents, enrollment_codes); from Phase 2, handlers set `memos.agent_projects` per
 * request (SET LOCAL inside a transaction) so the policies filter by the agent's scope.
 */
import "../env.js"; // side effect: load the repo-root .env
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

const url = process.env.MEMOS_APP_DATABASE_URL ?? "";

export const gatewayClient = postgres(url, { max: 10, onnotice: () => {} });
export const gatewayDb = drizzle(gatewayClient, { schema });

export type GatewayDb = typeof gatewayDb;

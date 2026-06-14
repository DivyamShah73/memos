/** Per-request context handed to every intent handler. */
import type { GatewayDb } from "../db/gateway.js";
import type { AuthedAgent } from "./auth.js";
import type { WithScope } from "./scope.js";

export interface IntentContext {
  /** The authed agent, or null for public intents (agent.enroll). */
  agent: AuthedAgent | null;
  /**
   * memos_app-connected Drizzle client. Use this directly ONLY for control-plane tables
   * that have no RLS (orgs/teams/projects/agents/enrollment_codes). For any tenant-scoped
   * table (workflow_runs/checkins/objectives/facts/…), go through `withScope` so the RLS
   * GUC is set — a raw read of an RLS'd table returns 0 rows (default-deny).
   */
  db: GatewayDb;
  /**
   * Run DB work in a transaction with the agent's RLS scope set. Present only for authed
   * intents (a public handler has none, so it can't accidentally do an RLS write).
   */
  withScope?: WithScope;
  /** Best-effort client identifier for rate limiting public calls. */
  clientIp: string;
}

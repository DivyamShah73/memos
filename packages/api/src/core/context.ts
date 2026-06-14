/** Per-request context handed to every intent handler. */
import type { GatewayDb } from "../db/gateway.js";
import type { AuthedAgent } from "./auth.js";

export interface IntentContext {
  /** The authed agent, or null for public intents (agent.enroll). */
  agent: AuthedAgent | null;
  /** memos_app-connected Drizzle client (RLS applies from Phase 2). */
  db: GatewayDb;
  /** Best-effort client identifier for rate limiting public calls. */
  clientIp: string;
}

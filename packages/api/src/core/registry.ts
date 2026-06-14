/**
 * Intent registry — the dispatch table. Every intent is one entry here, so the single
 * route applies auth/validation/rate-limit uniformly (ADR-001). New intents are added
 * via the scaffold-intent skill.
 */
import type { ZodTypeAny } from "zod";
import { checkinInputSchema, enrollInputSchema, workflowCreateInputSchema } from "@memos/shared";
import type { IntentContext } from "./context.js";
import type { Envelope } from "./envelope.js";
import { enroll } from "../intents/agent.enroll.js";
import { workflowCreate } from "../intents/workflow.create.js";
import { checkin } from "../intents/checkin.js";

export interface IntentDef {
  schema: ZodTypeAny;
  handler: (ctx: IntentContext, input: never) => Promise<Envelope>;
  /** Everything except agent.enroll requires a valid bearer token. */
  requiresAuth: boolean;
  /** Reserved for per-intent scope checks (Phase 2+). */
  scope?: string;
}

export const registry = new Map<string, IntentDef>([
  [
    "agent.enroll",
    {
      schema: enrollInputSchema,
      handler: enroll as IntentDef["handler"],
      requiresAuth: false,
    },
  ],
  [
    "workflow.create",
    {
      schema: workflowCreateInputSchema,
      handler: workflowCreate as IntentDef["handler"],
      requiresAuth: true,
    },
  ],
  [
    "checkin",
    {
      schema: checkinInputSchema,
      handler: checkin as IntentDef["handler"],
      requiresAuth: true,
    },
  ],
]);

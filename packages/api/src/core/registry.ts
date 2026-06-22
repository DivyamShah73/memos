/**
 * Intent registry — the dispatch table. Every intent is one entry here, so the single
 * route applies auth/validation/rate-limit uniformly (ADR-001). New intents are added
 * via the scaffold-intent skill.
 */
import type { ZodTypeAny } from "zod";
import {
  artifactUploadInputSchema,
  checkinInputSchema,
  enrollInputSchema,
  factQueryInputSchema,
  factRecordInputSchema,
  keyResultUpdateInputSchema,
  learningQueryInputSchema,
  learningRecordInputSchema,
  milestoneAchieveInputSchema,
  objectivePublishInputSchema,
  objectiveQueryInputSchema,
  objectiveUpdateInputSchema,
  workflowCreateInputSchema,
} from "@memos/shared";
import type { IntentContext } from "./context.js";
import type { Envelope } from "./envelope.js";
import { enroll } from "../intents/agent.enroll.js";
import { workflowCreate } from "../intents/workflow.create.js";
import { checkin } from "../intents/checkin.js";
import { artifactUpload } from "../intents/artifact.upload.js";
import { factRecord } from "../intents/fact.record.js";
import { learningRecord } from "../intents/learning.record.js";
import { factQuery } from "../intents/fact.query.js";
import { learningQuery } from "../intents/learning.query.js";
import { objectivePublish } from "../intents/objective.publish.js";
import { objectiveQuery } from "../intents/objective.query.js";
import { objectiveUpdate } from "../intents/objective.update.js";
import { milestoneAchieve } from "../intents/milestone.achieve.js";
import { keyResultUpdate } from "../intents/key_result.update.js";

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
  [
    "artifact.upload",
    {
      schema: artifactUploadInputSchema,
      handler: artifactUpload as IntentDef["handler"],
      requiresAuth: true,
    },
  ],
  [
    "fact.record",
    {
      schema: factRecordInputSchema,
      handler: factRecord as IntentDef["handler"],
      requiresAuth: true,
    },
  ],
  [
    "learning.record",
    {
      schema: learningRecordInputSchema,
      handler: learningRecord as IntentDef["handler"],
      requiresAuth: true,
    },
  ],
  [
    "fact.query",
    {
      schema: factQueryInputSchema,
      handler: factQuery as IntentDef["handler"],
      requiresAuth: true,
    },
  ],
  [
    "learning.query",
    {
      schema: learningQueryInputSchema,
      handler: learningQuery as IntentDef["handler"],
      requiresAuth: true,
    },
  ],
  [
    "objective.publish",
    {
      schema: objectivePublishInputSchema,
      handler: objectivePublish as IntentDef["handler"],
      requiresAuth: true,
    },
  ],
  [
    "objective.query",
    {
      schema: objectiveQueryInputSchema,
      handler: objectiveQuery as IntentDef["handler"],
      requiresAuth: true,
    },
  ],
  [
    "objective.update",
    {
      schema: objectiveUpdateInputSchema,
      handler: objectiveUpdate as IntentDef["handler"],
      requiresAuth: true,
    },
  ],
  [
    "milestone.achieve",
    {
      schema: milestoneAchieveInputSchema,
      handler: milestoneAchieve as IntentDef["handler"],
      requiresAuth: true,
    },
  ],
  [
    "key_result.update",
    {
      schema: keyResultUpdateInputSchema,
      handler: keyResultUpdate as IntentDef["handler"],
      requiresAuth: true,
    },
  ],
]);

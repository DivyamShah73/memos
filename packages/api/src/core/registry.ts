/**
 * Intent registry — the dispatch table. Every intent is one entry here, so the single
 * route applies auth/validation/rate-limit uniformly (ADR-001). New intents are added
 * via the scaffold-intent skill.
 */
import type { ZodTypeAny } from "zod";
import {
  activityRecentInputSchema,
  agentMeInputSchema,
  artifactUploadInputSchema,
  briefAckInputSchema,
  briefCreateInputSchema,
  briefFetchInputSchema,
  learningListInputSchema,
  provenanceTraceInputSchema,
  trustLeaderboardInputSchema,
  checkinInputSchema,
  enrollInputSchema,
  userLoginInputSchema,
  orgSignupInputSchema,
  enrollmentCreateInputSchema,
  userInviteInputSchema,
  agentRevokeInputSchema,
  memberOffboardInputSchema,
  factQueryInputSchema,
  factRecordInputSchema,
  keyResultUpdateInputSchema,
  learningQueryInputSchema,
  learningRecordInputSchema,
  milestoneAchieveInputSchema,
  objectivePublishInputSchema,
  objectiveQueryInputSchema,
  objectiveUpdateInputSchema,
  questionAnswerInputSchema,
  questionAskInputSchema,
  workflowCreateInputSchema,
} from "@memos/shared";
import type { IntentContext } from "./context.js";
import type { Envelope } from "./envelope.js";
import { enroll } from "../intents/agent.enroll.js";
import { userLogin } from "../intents/user.login.js";
import { orgSignup, enrollmentCreate, userInvite, agentRevoke, memberOffboard } from "../intents/admin.js";
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
import { briefFetch } from "../intents/brief.fetch.js";
import { briefAck } from "../intents/brief.ack.js";
import { questionAsk } from "../intents/question.ask.js";
import { questionAnswer } from "../intents/question.answer.js";
import { activityRecent } from "../intents/activity.recent.js";
import { agentMe } from "../intents/agent.me.js";
import { provenanceTrace } from "../intents/provenance.trace.js";
import { learningList } from "../intents/learning.list.js";
import { briefCreate } from "../intents/brief.create.js";
import { trustLeaderboard } from "../intents/trust.leaderboard.js";

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
    "user.login",
    {
      schema: userLoginInputSchema,
      handler: userLogin as IntentDef["handler"],
      requiresAuth: false, // public — exchanges email+password for a session token
    },
  ],
  [
    "org.signup",
    {
      schema: orgSignupInputSchema,
      handler: orgSignup as IntentDef["handler"],
      requiresAuth: false, // public — the product's front door (creates an org + its CEO)
    },
  ],
  [
    "enrollment.create",
    {
      schema: enrollmentCreateInputSchema,
      handler: enrollmentCreate as IntentDef["handler"],
      requiresAuth: true, // manager/CEO (authz matrix: ADMIN_INTENTS)
    },
  ],
  [
    "user.invite",
    {
      schema: userInviteInputSchema,
      handler: userInvite as IntentDef["handler"],
      requiresAuth: true,
    },
  ],
  [
    "agent.revoke",
    {
      schema: agentRevokeInputSchema,
      handler: agentRevoke as IntentDef["handler"],
      requiresAuth: true,
    },
  ],
  [
    "member.offboard",
    {
      schema: memberOffboardInputSchema,
      handler: memberOffboard as IntentDef["handler"],
      requiresAuth: true,
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
  [
    "brief.fetch",
    {
      schema: briefFetchInputSchema,
      handler: briefFetch as IntentDef["handler"],
      requiresAuth: true,
    },
  ],
  [
    "brief.ack",
    {
      schema: briefAckInputSchema,
      handler: briefAck as IntentDef["handler"],
      requiresAuth: true,
    },
  ],
  [
    "question.ask",
    {
      schema: questionAskInputSchema,
      handler: questionAsk as IntentDef["handler"],
      requiresAuth: true,
    },
  ],
  [
    "question.answer",
    {
      schema: questionAnswerInputSchema,
      handler: questionAnswer as IntentDef["handler"],
      requiresAuth: true,
    },
  ],
  [
    "activity.recent",
    {
      schema: activityRecentInputSchema,
      handler: activityRecent as IntentDef["handler"],
      requiresAuth: true,
    },
  ],
  [
    "agent.me",
    {
      schema: agentMeInputSchema,
      handler: agentMe as IntentDef["handler"],
      requiresAuth: true,
    },
  ],
  [
    "provenance.trace",
    {
      schema: provenanceTraceInputSchema,
      handler: provenanceTrace as IntentDef["handler"],
      requiresAuth: true,
    },
  ],
  [
    "learning.list",
    {
      schema: learningListInputSchema,
      handler: learningList as IntentDef["handler"],
      requiresAuth: true,
    },
  ],
  [
    "brief.create",
    {
      schema: briefCreateInputSchema,
      handler: briefCreate as IntentDef["handler"],
      requiresAuth: true,
    },
  ],
  [
    "trust.leaderboard",
    {
      schema: trustLeaderboardInputSchema,
      handler: trustLeaderboard as IntentDef["handler"],
      requiresAuth: true,
    },
  ],
]);

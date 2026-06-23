// @memos/shared — types and Zod schemas shared by the api gateway and the web
// dashboard. The package only exposes "." (see package.json exports), so every schema
// is barrel-exported here; consumers do `import { enrollInputSchema } from "@memos/shared"`.

export const MEMOS_SHARED_VERSION = "0.0.0";

export * from "./schemas/agent.enroll.js";
export * from "./schemas/workflow.create.js";
export * from "./schemas/checkin.js";
export * from "./schemas/artifact.upload.js";
export * from "./schemas/fact.record.js";
export * from "./schemas/learning.record.js";
export * from "./schemas/fact.query.js";
export * from "./schemas/learning.query.js";
export * from "./schemas/objective.publish.js";
export * from "./schemas/objective.query.js";
export * from "./schemas/objective.update.js";
export * from "./schemas/milestone.achieve.js";
export * from "./schemas/key_result.update.js";
export * from "./schemas/brief.fetch.js";
export * from "./schemas/brief.ack.js";
export * from "./schemas/question.ask.js";
export * from "./schemas/question.answer.js";
export * from "./schemas/activity.recent.js";
export * from "./schemas/agent.me.js";
export * from "./schemas/provenance.trace.js";
export * from "./schemas/learning.list.js";
export * from "./schemas/brief.create.js";
export * from "./schemas/trust.leaderboard.js";

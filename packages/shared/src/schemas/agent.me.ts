import { z } from "zod";

/** Input for `agent.me` — none; returns the calling agent's identity + scopes (no body needed). */
export const agentMeInputSchema = z.object({});

export type AgentMeInput = z.infer<typeof agentMeInputSchema>;

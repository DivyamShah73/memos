import { z } from "zod";

/**
 * Input for `agent.list` (Phase 15, manager/CEO) — none. Lists the agents in the caller's org
 * (the `agents` control-plane table, filtered by org_id in the handler — it has no RLS).
 */
export const agentListInputSchema = z.object({});

export type AgentListInput = z.infer<typeof agentListInputSchema>;

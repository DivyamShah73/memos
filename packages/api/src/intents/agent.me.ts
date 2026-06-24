/**
 * agent.me — the calling agent's own identity + scopes. Lets the dashboard discover which
 * projects the operator token can see (its project switcher) without hardcoding. Reads only
 * from ctx.agent (already resolved by auth) — no DB round-trip.
 */
import type { AgentMeInput } from "@memos/shared";
import type { IntentContext } from "../core/context.js";
import { ERROR_TYPE, fail, ok, type Envelope } from "../core/envelope.js";

export async function agentMe(ctx: IntentContext, _input: AgentMeInput): Promise<Envelope> {
  const agent = ctx.agent;
  if (!agent) return fail("authentication required", ERROR_TYPE.unauthorized);
  return ok({
    agent_id: agent.id,
    scopes: agent.scopes,
    team_id: agent.teamId,
    org_id: agent.orgId,
    role: agent.role, // Phase 15: lets the dashboard gate admin surfaces by role
  });
}

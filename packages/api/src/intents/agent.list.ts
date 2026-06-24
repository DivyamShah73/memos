/**
 * agent.list (Phase 15, manager/CEO) — the agents in the caller's org. `agents` is a control-plane
 * table with NO RLS (it's read by-token during auth), so we org-scope this enumeration in the
 * handler — `where org_id = caller.orgId` — exactly like trust.leaderboard. A missing filter would
 * leak agents across orgs, so the org-isolation test guards it.
 */
import { eq } from "drizzle-orm";
import type { AgentListInput } from "@memos/shared";
import type { IntentContext } from "../core/context.js";
import { ERROR_TYPE, fail, ok, type Envelope } from "../core/envelope.js";
import { agents } from "../db/schema.js";

export async function agentList(ctx: IntentContext, _input: AgentListInput): Promise<Envelope> {
  const agent = ctx.agent;
  if (!agent) return fail("authentication required", ERROR_TYPE.unauthorized);

  const rows = agent.orgId
    ? await ctx.db
        .select({
          id: agents.id,
          displayName: agents.displayName,
          role: agents.role,
          status: agents.status,
          scopes: agents.scopes,
          trustScore: agents.trustScore,
          lastCheckinAt: agents.lastCheckinAt,
        })
        .from(agents)
        .where(eq(agents.orgId, agent.orgId))
    : [];

  const list = rows.map((a) => ({
    agent_id: a.id,
    display_name: a.displayName,
    role: a.role,
    status: a.status,
    scopes: a.scopes,
    trust_score: Number(a.trustScore),
    last_checkin_at: a.lastCheckinAt,
  }));

  return ok({ agents: list });
}

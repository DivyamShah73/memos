/**
 * trust.leaderboard — agents on the caller's team ranked by trust score, with how many learnings
 * each authored in this project. Agents come from the control-plane table (filtered to the
 * caller's team); the authored counts are an in-scope (RLS) group-by over learnings.
 */
import { and, count, eq } from "drizzle-orm";
import type { TrustLeaderboardInput } from "@memos/shared";
import type { IntentContext } from "../core/context.js";
import { ERROR_TYPE, fail, ok, type Envelope } from "../core/envelope.js";
import { agents, learnings } from "../db/schema.js";

export async function trustLeaderboard(
  ctx: IntentContext,
  input: TrustLeaderboardInput,
): Promise<Envelope> {
  const agent = ctx.agent;
  const withScope = ctx.withScope;
  if (!agent || !withScope) return fail("authentication required", ERROR_TYPE.unauthorized);

  const { project_id } = input;
  if (!agent.scopes.includes(project_id)) {
    return fail(`project ${project_id} is not in scope`, ERROR_TYPE.forbidden);
  }

  const agentRows = agent.teamId
    ? await ctx.db
        .select({ id: agents.id, displayName: agents.displayName, trustScore: agents.trustScore })
        .from(agents)
        .where(eq(agents.teamId, agent.teamId))
    : [];

  const counts = await withScope((tx) =>
    tx
      .select({ agentId: learnings.agentId, n: count() })
      .from(learnings)
      .where(and(eq(learnings.projectId, project_id), eq(learnings.status, "active")))
      .groupBy(learnings.agentId),
  );
  const byAgent = new Map(counts.map((c) => [c.agentId, Number(c.n)]));

  const leaderboard = agentRows
    .map((a) => ({
      agent_id: a.id,
      display_name: a.displayName,
      trust_score: Number(a.trustScore),
      learnings_authored: byAgent.get(a.id) ?? 0,
    }))
    .sort((x, y) => y.trust_score - x.trust_score);

  return ok({ leaderboard });
}

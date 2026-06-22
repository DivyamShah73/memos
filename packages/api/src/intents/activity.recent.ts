/**
 * activity.recent — the initial page of the dashboard feed: recent checkins + facts + learnings
 * in one project, newest first. Runs inside withScope (RLS) + explicit project_id filter (same
 * isolation as fact.query). The live tail then arrives via the SSE stream. checkins carry no
 * agent_id, so we join the workflow run to attribute them.
 */
import { and, desc, eq } from "drizzle-orm";
import type { ActivityRecentInput } from "@memos/shared";
import type { IntentContext } from "../core/context.js";
import { ERROR_TYPE, fail, ok, type Envelope } from "../core/envelope.js";
import { checkins, facts, learnings, milestones, workflowRuns } from "../db/schema.js";

interface FeedItem {
  type: "checkin" | "fact" | "learning" | "milestone";
  summary: string;
  agent_id: string | null;
  bd_id: string | null;
  created_at: Date;
}

export async function activityRecent(
  ctx: IntentContext,
  input: ActivityRecentInput,
): Promise<Envelope> {
  const agent = ctx.agent;
  const withScope = ctx.withScope;
  if (!agent || !withScope) return fail("authentication required", ERROR_TYPE.unauthorized);

  const { project_id, limit } = input;
  if (!agent.scopes.includes(project_id)) {
    return fail(`project ${project_id} is not in scope`, ERROR_TYPE.forbidden);
  }

  const { factRows, learningRows, checkinRows, milestoneRows } = await withScope(async (tx) => {
    const factRows = await tx
      .select({ claim: facts.claim, agentId: facts.agentId, bdId: facts.bdId, createdAt: facts.createdAt })
      .from(facts)
      .where(eq(facts.projectId, project_id))
      .orderBy(desc(facts.createdAt))
      .limit(limit);
    const learningRows = await tx
      .select({ claim: learnings.claim, agentId: learnings.agentId, bdId: learnings.bdId, createdAt: learnings.createdAt })
      .from(learnings)
      .where(eq(learnings.projectId, project_id))
      .orderBy(desc(learnings.createdAt))
      .limit(limit);
    const checkinRows = await tx
      .select({
        status: checkins.status,
        currentTask: checkins.currentTask,
        bdId: checkins.bdId,
        createdAt: checkins.createdAt,
        agentId: workflowRuns.agentId,
      })
      .from(checkins)
      .leftJoin(workflowRuns, eq(checkins.bdId, workflowRuns.bdId))
      .where(eq(checkins.projectId, project_id))
      .orderBy(desc(checkins.createdAt))
      .limit(limit);
    const milestoneRows = await tx
      .select({
        title: milestones.title,
        achievement: milestones.achievement,
        achievedAt: milestones.achievedAt,
      })
      .from(milestones)
      .where(and(eq(milestones.projectId, project_id), eq(milestones.status, "achieved")))
      .orderBy(desc(milestones.achievedAt))
      .limit(limit);
    return { factRows, learningRows, checkinRows, milestoneRows };
  });

  const items: FeedItem[] = [
    ...factRows.map((r) => ({ type: "fact" as const, summary: r.claim, agent_id: r.agentId, bd_id: r.bdId, created_at: r.createdAt })),
    ...learningRows.map((r) => ({ type: "learning" as const, summary: r.claim, agent_id: r.agentId, bd_id: r.bdId, created_at: r.createdAt })),
    ...checkinRows.map((r) => ({
      type: "checkin" as const,
      summary: r.currentTask ? `${r.status} — ${r.currentTask}` : r.status,
      agent_id: r.agentId ?? null,
      bd_id: r.bdId,
      created_at: r.createdAt,
    })),
    ...milestoneRows
      .filter((r) => r.achievedAt !== null)
      .map((r) => ({
        type: "milestone" as const,
        summary: `achieved: ${r.title}`,
        agent_id: (r.achievement as { agent_id?: string } | null)?.agent_id ?? null,
        bd_id: null,
        created_at: r.achievedAt as Date,
      })),
  ];
  items.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());

  return ok({
    activity: items.slice(0, limit).map((i) => ({
      type: i.type,
      summary: i.summary,
      agent_id: i.agent_id,
      bd_id: i.bd_id,
      created_at: i.created_at,
    })),
  });
}

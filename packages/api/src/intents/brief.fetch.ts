/**
 * brief.fetch — return the standing briefs targeting this agent plus the project's active OKRs.
 *
 * Briefs are identity-targeted; the `briefs_select` RLS policy (ADR-006) already limits the rows
 * to this agent's identity set {agent.x, team.x, org, project.*} via the memos.agent_identity GUC.
 * On top of RLS we narrow project-targeted briefs to THIS project (the identity set spans all the
 * agent's projects), hide superseded briefs, and — unless include_acked — hide ones this agent
 * already acked. active_okrs reuses the OKR rollup (_okr.ts).
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { BriefFetchInput } from "@memos/shared";
import type { IntentContext } from "../core/context.js";
import { ERROR_TYPE, fail, ok, type Envelope } from "../core/envelope.js";
import { indexObjectives, num, objectiveProgress, type ObjectiveRow } from "./_okr.js";
import { briefs, milestones, objectives } from "../db/schema.js";

export async function briefFetch(ctx: IntentContext, input: BriefFetchInput): Promise<Envelope> {
  const agent = ctx.agent;
  const withScope = ctx.withScope;
  if (!agent || !withScope) return fail("authentication required", ERROR_TYPE.unauthorized);

  const { project_id, include_acked } = input;
  if (!agent.scopes.includes(project_id)) {
    return fail(`project ${project_id} is not in scope`, ERROR_TYPE.forbidden);
  }

  const { briefRows, objs, mss } = await withScope(async (tx) => {
    const briefRows = await tx
      .select({
        id: briefs.id,
        title: briefs.title,
        body: briefs.body,
        targetKind: briefs.targetKind,
        targetId: briefs.targetId,
        effectiveFrom: briefs.effectiveFrom,
        createdAt: briefs.createdAt,
      })
      .from(briefs)
      .where(
        and(
          // RLS already restricts to this agent's identity; narrow project-targeted briefs to
          // the requested project (the identity set spans ALL the agent's projects).
          sql`(${briefs.targetKind} <> 'project' OR ${briefs.targetId} = ${project_id})`,
          // Hide superseded briefs (some newer brief points at this one via supersedes_id).
          sql`${briefs.id} NOT IN (SELECT supersedes_id FROM briefs WHERE supersedes_id IS NOT NULL)`,
          include_acked
            ? undefined
            : sql`${briefs.id} NOT IN (SELECT brief_id FROM brief_acks WHERE agent_id = ${agent.id})`,
        ),
      )
      .orderBy(desc(briefs.effectiveFrom));

    const objs = await tx
      .select({
        id: objectives.id,
        parentId: objectives.parentId,
        status: objectives.status,
        weight: objectives.weight,
        title: objectives.title,
        targetCompletion: objectives.targetCompletion,
      })
      .from(objectives)
      .where(eq(objectives.projectId, project_id));
    const mss = await tx
      .select({
        objectiveId: milestones.objectiveId,
        status: milestones.status,
        metricTarget: milestones.metricTarget,
        metricCurrent: milestones.metricCurrent,
        metricDirection: milestones.metricDirection,
      })
      .from(milestones)
      .where(eq(milestones.projectId, project_id));
    return { briefRows, objs, mss };
  });

  const { childrenByParent, milestonesByObjective } = indexObjectives(objs, mss);
  const active_okrs = objs
    .filter((o) => o.status === "active" && o.parentId === null)
    .map((o) => ({
      id: o.id,
      title: o.title,
      status: o.status,
      target_completion: o.targetCompletion,
      progress: objectiveProgress(o as ObjectiveRow, childrenByParent, milestonesByObjective),
    }));

  return ok({
    briefs: briefRows.map((b) => ({
      id: b.id,
      title: b.title,
      body: b.body,
      target_kind: b.targetKind,
      target_id: b.targetId,
      effective_from: b.effectiveFrom,
      created_at: b.createdAt,
    })),
    active_okrs,
  });
}

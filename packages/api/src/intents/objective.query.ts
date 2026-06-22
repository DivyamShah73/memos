/**
 * objective.query — read a project's OKR tree with rolled-up progress (ADR-005). Reads all the
 * project's objectives + milestones in-scope (RLS + explicit project_id filter), builds the tree
 * in JS, and computes progress via _okr.ts. With objective_id, returns that subtree; otherwise
 * all root objectives. A query in project A can never surface project B's rows.
 */
import { eq } from "drizzle-orm";
import type { ObjectiveQueryInput } from "@memos/shared";
import type { IntentContext } from "../core/context.js";
import { ERROR_TYPE, fail, ok, type Envelope } from "../core/envelope.js";
import { indexObjectives, krProgress, objectiveProgress, type ObjectiveRow } from "./_okr.js";
import { milestones, objectives } from "../db/schema.js";

const numOrNull = (v: string | null): number | null => (v === null ? null : Number(v));

export async function objectiveQuery(
  ctx: IntentContext,
  input: ObjectiveQueryInput,
): Promise<Envelope> {
  const agent = ctx.agent;
  const withScope = ctx.withScope;
  if (!agent || !withScope) return fail("authentication required", ERROR_TYPE.unauthorized);

  const { project_id, objective_id, include_children } = input;
  if (!agent.scopes.includes(project_id)) {
    return fail(`project ${project_id} is not in scope`, ERROR_TYPE.forbidden);
  }

  const { objs, mss } = await withScope(async (tx) => {
    const objs = await tx
      .select({
        id: objectives.id,
        parentId: objectives.parentId,
        status: objectives.status,
        weight: objectives.weight,
        title: objectives.title,
        description: objectives.description,
        targetCompletion: objectives.targetCompletion,
        createdAt: objectives.createdAt,
      })
      .from(objectives)
      .where(eq(objectives.projectId, project_id));
    const mss = await tx
      .select({
        id: milestones.id,
        objectiveId: milestones.objectiveId,
        title: milestones.title,
        status: milestones.status,
        position: milestones.position,
        metricTarget: milestones.metricTarget,
        metricCurrent: milestones.metricCurrent,
        metricUnit: milestones.metricUnit,
        metricDirection: milestones.metricDirection,
      })
      .from(milestones)
      .where(eq(milestones.projectId, project_id));
    return { objs, mss };
  });

  const { childrenByParent, milestonesByObjective } = indexObjectives(objs, mss);

  let roots: typeof objs;
  if (objective_id) {
    const found = objs.find((o) => o.id === objective_id);
    if (!found) return fail("objective not found in this project", ERROR_TYPE.badRequest);
    roots = [found];
  } else {
    roots = objs.filter((o) => o.parentId === null);
  }

  const serialize = (o: (typeof objs)[number]): unknown => ({
    id: o.id,
    parent_id: o.parentId,
    title: o.title,
    description: o.description,
    status: o.status,
    weight: numOrNull(o.weight),
    target_completion: o.targetCompletion,
    progress: objectiveProgress(o as ObjectiveRow, childrenByParent, milestonesByObjective),
    milestones: (milestonesByObjective.get(o.id) ?? []).map((m) => {
      const mm = m as (typeof mss)[number];
      return {
        id: mm.id,
        title: mm.title,
        status: mm.status,
        position: mm.position,
        metric_target: numOrNull(mm.metricTarget),
        metric_current: numOrNull(mm.metricCurrent),
        metric_unit: mm.metricUnit,
        metric_direction: mm.metricDirection,
        progress: krProgress(mm),
      };
    }),
    children: include_children
      ? (childrenByParent.get(o.id) ?? []).map((c) => serialize(c as (typeof objs)[number]))
      : [],
  });

  return ok({ objectives: roots.map(serialize) });
}

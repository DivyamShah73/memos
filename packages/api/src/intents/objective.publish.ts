/**
 * objective.publish — create an objective (optionally a sub-OKR via parent_id + weight) with
 * optional inline milestones/KRs, threaded onto a workflow run (bd_id). All-or-nothing in one
 * withScope tx. A sub-OKR's parent must be a non-abandoned objective in the same project.
 */
import { and, eq } from "drizzle-orm";
import type { ObjectivePublishInput } from "@memos/shared";
import type { IntentContext } from "../core/context.js";
import { ERROR_TYPE, fail, ok, type Envelope } from "../core/envelope.js";
import { isRlsViolation } from "../core/pgerrors.js";
import { assertRunWritable } from "./_evidence.js";
import { milestones, objectives } from "../db/schema.js";

type TxResult =
  | { kind: "validation"; message: string }
  | { kind: "created"; objectiveId: string; milestoneIds: string[] };

export async function objectivePublish(
  ctx: IntentContext,
  input: ObjectivePublishInput,
): Promise<Envelope> {
  const agent = ctx.agent;
  const withScope = ctx.withScope;
  if (!agent || !withScope) return fail("authentication required", ERROR_TYPE.unauthorized);

  const { project_id, bd_id, title, description, target_completion, parent_id, weight } = input;
  const ms = input.milestones;
  if (!agent.scopes.includes(project_id)) {
    return fail(`project ${project_id} is not in scope`, ERROR_TYPE.forbidden);
  }

  try {
    const result = await withScope(async (tx): Promise<TxResult> => {
      const run = await assertRunWritable(tx, project_id, bd_id);
      if (!run.ok) return { kind: "validation", message: run.message };

      // A sub-OKR's parent must exist in THIS project (RLS hides another tenant's → "not found")
      // and not be abandoned/superseded (mirrors the workflow.create binding rule).
      if (parent_id) {
        const parent = await tx
          .select({ status: objectives.status })
          .from(objectives)
          .where(and(eq(objectives.id, parent_id), eq(objectives.projectId, project_id)))
          .limit(1);
        if (parent.length === 0) {
          return { kind: "validation", message: "parent_id not found in this project" };
        }
        if (parent[0].status === "abandoned" || parent[0].status === "superseded") {
          return { kind: "validation", message: `parent_id is ${parent[0].status}; cannot nest under it` };
        }
      }

      const [obj] = await tx
        .insert(objectives)
        .values({
          projectId: project_id,
          bdId: bd_id,
          agentId: agent.id,
          parentId: parent_id ?? null,
          weight: weight !== undefined ? String(weight) : null,
          title,
          description: description ?? null,
          targetCompletion: target_completion ? new Date(target_completion) : null,
          status: "active",
        })
        .returning({ id: objectives.id });

      const milestoneIds: string[] = [];
      if (ms && ms.length > 0) {
        const rows = await tx
          .insert(milestones)
          .values(
            ms.map((m) => ({
              objectiveId: obj.id,
              projectId: project_id, // denormalized so the project_id RLS template applies
              title: m.title,
              description: m.description ?? null,
              position: m.position ?? null,
              metricTarget: m.metric_target !== undefined ? String(m.metric_target) : null,
              metricCurrent: m.metric_current !== undefined ? String(m.metric_current) : null,
              metricUnit: m.metric_unit ?? null,
              metricDirection: m.metric_direction ?? null,
              status: "pending",
            })),
          )
          .returning({ id: milestones.id });
        milestoneIds.push(...rows.map((r) => r.id));
      }

      return { kind: "created", objectiveId: obj.id, milestoneIds };
    });

    if (result.kind === "validation") return fail(result.message, ERROR_TYPE.badRequest);
    return ok({ objective_id: result.objectiveId, milestone_ids: result.milestoneIds });
  } catch (err) {
    if (isRlsViolation(err)) {
      return fail(`project ${project_id} is not in scope`, ERROR_TYPE.forbidden);
    }
    throw err;
  }
}

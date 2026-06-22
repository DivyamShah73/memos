/**
 * key_result.update — move a key result's current metric and read back the recomputed KR
 * progress + parent objective rollup. The target must be a KR (have a metric_target). Updating
 * the metric does NOT achieve the milestone — achievement is explicit + evidence-gated.
 */
import { and, eq } from "drizzle-orm";
import type { KeyResultUpdateInput } from "@memos/shared";
import type { IntentContext } from "../core/context.js";
import { ERROR_TYPE, fail, ok, type Envelope } from "../core/envelope.js";
import { isRlsViolation } from "../core/pgerrors.js";
import { assertRunWritable } from "./_evidence.js";
import { krProgress, recomputeObjectiveProgress } from "./_okr.js";
import { milestones } from "../db/schema.js";

type TxResult =
  | { kind: "validation"; message: string }
  | {
      kind: "updated";
      objectiveId: string;
      metricTarget: string | null;
      metricDirection: string | null;
      krProgress: number;
      objectiveProgress: number | null;
    };

export async function keyResultUpdate(
  ctx: IntentContext,
  input: KeyResultUpdateInput,
): Promise<Envelope> {
  const agent = ctx.agent;
  const withScope = ctx.withScope;
  if (!agent || !withScope) return fail("authentication required", ERROR_TYPE.unauthorized);

  const { project_id, milestone_id, metric_current, bd_id } = input;
  if (!agent.scopes.includes(project_id)) {
    return fail(`project ${project_id} is not in scope`, ERROR_TYPE.forbidden);
  }

  try {
    const result = await withScope(async (tx): Promise<TxResult> => {
      if (bd_id) {
        const run = await assertRunWritable(tx, project_id, bd_id);
        if (!run.ok) return { kind: "validation", message: run.message };
      }

      const found = await tx
        .select({
          status: milestones.status,
          objectiveId: milestones.objectiveId,
          metricTarget: milestones.metricTarget,
          metricDirection: milestones.metricDirection,
        })
        .from(milestones)
        .where(and(eq(milestones.id, milestone_id), eq(milestones.projectId, project_id)))
        .limit(1);
      if (found.length === 0) {
        return { kind: "validation", message: "milestone not found in this project" };
      }
      if (found[0].metricTarget === null) {
        return { kind: "validation", message: "milestone has no metric_target; not a key result" };
      }

      await tx
        .update(milestones)
        .set({ metricCurrent: String(metric_current) })
        .where(and(eq(milestones.id, milestone_id), eq(milestones.projectId, project_id)));

      const kr = krProgress({
        status: found[0].status,
        metricTarget: found[0].metricTarget,
        metricCurrent: String(metric_current),
        metricDirection: found[0].metricDirection,
      });
      const objectiveProgress = await recomputeObjectiveProgress(tx, project_id, found[0].objectiveId);
      return {
        kind: "updated",
        objectiveId: found[0].objectiveId,
        metricTarget: found[0].metricTarget,
        metricDirection: found[0].metricDirection,
        krProgress: kr,
        objectiveProgress,
      };
    });

    if (result.kind === "validation") return fail(result.message, ERROR_TYPE.badRequest);
    return ok({
      milestone_id,
      metric_current,
      metric_target: result.metricTarget === null ? null : Number(result.metricTarget),
      metric_direction: result.metricDirection,
      progress: result.krProgress,
      objective_id: result.objectiveId,
      objective_progress: result.objectiveProgress,
    });
  } catch (err) {
    if (isRlsViolation(err)) {
      return fail(`project ${project_id} is not in scope`, ERROR_TYPE.forbidden);
    }
    throw err;
  }
}

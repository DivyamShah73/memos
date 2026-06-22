/**
 * milestone.achieve — flip a milestone/KR to achieved and store an achievement snapshot. The
 * achievement asserts a claim, so it's evidence-gated like fact/learning: confidence >= medium
 * requires an evidence_artifact_id in the same project + run (reuses _evidence.ts). Achieving an
 * already-achieved milestone is a clean business error (won't overwrite the snapshot).
 */
import { and, eq } from "drizzle-orm";
import type { MilestoneAchieveInput } from "@memos/shared";
import type { IntentContext } from "../core/context.js";
import { ERROR_TYPE, fail, ok, type Envelope } from "../core/envelope.js";
import { isRlsViolation } from "../core/pgerrors.js";
import { assertEvidence, assertRunWritable } from "./_evidence.js";
import { recomputeObjectiveProgress } from "./_okr.js";
import { milestones } from "../db/schema.js";

type TxResult =
  | { kind: "validation"; message: string }
  | { kind: "achieved"; objectiveId: string; progress: number | null };

export async function milestoneAchieve(
  ctx: IntentContext,
  input: MilestoneAchieveInput,
): Promise<Envelope> {
  const agent = ctx.agent;
  const withScope = ctx.withScope;
  if (!agent || !withScope) return fail("authentication required", ERROR_TYPE.unauthorized);

  const { project_id, bd_id, milestone_id, claim, confidence, evidence_artifact_id } = input;
  if (!agent.scopes.includes(project_id)) {
    return fail(`project ${project_id} is not in scope`, ERROR_TYPE.forbidden);
  }

  try {
    const result = await withScope(async (tx): Promise<TxResult> => {
      const run = await assertRunWritable(tx, project_id, bd_id);
      if (!run.ok) return { kind: "validation", message: run.message };

      // Evidence gate (defense in depth over the Zod superRefine) + cite validation: the
      // artifact must be a real one in this project AND run.
      const ev = await assertEvidence(tx, {
        projectId: project_id,
        bdId: bd_id,
        items: [{ confidence, evidence_artifact_id }],
      });
      if (ev.kind === "validation") return { kind: "validation", message: ev.message };

      const found = await tx
        .select({ status: milestones.status, objectiveId: milestones.objectiveId })
        .from(milestones)
        .where(and(eq(milestones.id, milestone_id), eq(milestones.projectId, project_id)))
        .limit(1);
      if (found.length === 0) {
        return { kind: "validation", message: "milestone not found in this project" };
      }
      if (found[0].status === "achieved") {
        return { kind: "validation", message: "milestone already achieved" };
      }
      const objectiveId = found[0].objectiveId;

      const achievedAt = new Date();
      await tx
        .update(milestones)
        .set({
          status: "achieved",
          achievedAt,
          achievement: {
            claim,
            confidence,
            evidence_artifact_id: evidence_artifact_id ?? null,
            achieved_at: achievedAt.toISOString(),
            agent_id: agent.id,
          },
        })
        .where(and(eq(milestones.id, milestone_id), eq(milestones.projectId, project_id)));

      const progress = await recomputeObjectiveProgress(tx, project_id, objectiveId);
      return { kind: "achieved", objectiveId, progress };
    });

    if (result.kind === "validation") return fail(result.message, ERROR_TYPE.badRequest);
    return ok({
      milestone_id,
      status: "achieved",
      objective_id: result.objectiveId,
      objective_progress: result.progress,
    });
  } catch (err) {
    if (isRlsViolation(err)) {
      return fail(`project ${project_id} is not in scope`, ERROR_TYPE.forbidden);
    }
    throw err;
  }
}

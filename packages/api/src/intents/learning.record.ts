/**
 * learning.record — batched, evidence-gated AND non-obvious-gated. All-or-nothing in one
 * withScope tx. A learning at confidence >= medium needs both an evidence_artifact_id (same
 * project/run) and a non_obvious_marker (>= 15 chars).
 */
import { and, eq } from "drizzle-orm";
import type { LearningRecordInput } from "@memos/shared";
import type { IntentContext } from "../core/context.js";
import { ERROR_TYPE, fail, ok, type Envelope } from "../core/envelope.js";
import { isRlsViolation } from "../core/pgerrors.js";
import { assertEvidence } from "./_evidence.js";
import { learnings as learningsTable, workflowRuns } from "../db/schema.js";

type TxResult = { kind: "error"; message: string } | { kind: "ok"; ids: string[] };

export async function learningRecord(
  ctx: IntentContext,
  input: LearningRecordInput,
): Promise<Envelope> {
  const agent = ctx.agent;
  const withScope = ctx.withScope;
  if (!agent || !withScope) return fail("authentication required", ERROR_TYPE.unauthorized);

  const { project_id, bd_id, learnings } = input;
  if (!agent.scopes.includes(project_id)) {
    return fail(`project ${project_id} is not in scope`, ERROR_TYPE.forbidden);
  }

  try {
    const result: TxResult = await withScope(async (tx): Promise<TxResult> => {
      const run = await tx
        .select({ bdId: workflowRuns.bdId })
        .from(workflowRuns)
        .where(and(eq(workflowRuns.bdId, bd_id), eq(workflowRuns.projectId, project_id)))
        .limit(1);
      if (run.length === 0) return { kind: "error", message: "unknown workflow run" };

      const ev = await assertEvidence(tx, {
        projectId: project_id,
        bdId: bd_id,
        items: learnings,
        requireMarker: true,
      });
      if (ev.kind === "validation") return { kind: "error", message: ev.message };

      const inserted = await tx
        .insert(learningsTable)
        .values(
          learnings.map((l) => ({
            projectId: project_id,
            bdId: bd_id,
            agentId: agent.id,
            claim: l.claim,
            appliesTo: l.applies_to,
            confidence: l.confidence,
            nonObviousMarker: l.non_obvious_marker ?? null,
            evidenceArtifactId: l.evidence_artifact_id ?? null,
          })),
        )
        .returning({ id: learningsTable.id });
      return { kind: "ok", ids: inserted.map((r) => r.id) };
    });

    if (result.kind === "error") return fail(result.message, ERROR_TYPE.badRequest);
    return ok({ learning_ids: result.ids });
  } catch (err) {
    if (isRlsViolation(err)) {
      return fail(`project ${project_id} is not in scope`, ERROR_TYPE.forbidden);
    }
    throw err;
  }
}

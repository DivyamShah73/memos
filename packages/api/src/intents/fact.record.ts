/**
 * fact.record — batched, evidence-gated. All-or-nothing: if any fact fails the gate or cites a
 * bad artifact, the whole batch is rejected (one withScope tx → clean rollback).
 */
import { and, eq } from "drizzle-orm";
import type { FactRecordInput } from "@memos/shared";
import type { IntentContext } from "../core/context.js";
import { ERROR_TYPE, fail, ok, type Envelope } from "../core/envelope.js";
import { isRlsViolation } from "../core/pgerrors.js";
import { assertEvidence } from "./_evidence.js";
import { facts as factsTable, workflowRuns } from "../db/schema.js";

type TxResult = { kind: "error"; message: string } | { kind: "ok"; ids: string[] };

export async function factRecord(ctx: IntentContext, input: FactRecordInput): Promise<Envelope> {
  const agent = ctx.agent;
  const withScope = ctx.withScope;
  if (!agent || !withScope) return fail("authentication required", ERROR_TYPE.unauthorized);

  const { project_id, bd_id, facts } = input;
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

      const ev = await assertEvidence(tx, { projectId: project_id, bdId: bd_id, items: facts });
      if (ev.kind === "validation") return { kind: "error", message: ev.message };

      const inserted = await tx
        .insert(factsTable)
        .values(
          facts.map((f) => ({
            projectId: project_id,
            bdId: bd_id,
            agentId: agent.id,
            claim: f.claim,
            confidence: f.confidence,
            evidenceArtifactId: f.evidence_artifact_id ?? null,
          })),
        )
        .returning({ id: factsTable.id });
      return { kind: "ok", ids: inserted.map((r) => r.id) };
    });

    if (result.kind === "error") return fail(result.message, ERROR_TYPE.badRequest);
    return ok({ fact_ids: result.ids });
  } catch (err) {
    if (isRlsViolation(err)) {
      return fail(`project ${project_id} is not in scope`, ERROR_TYPE.forbidden);
    }
    throw err;
  }
}

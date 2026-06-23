/**
 * learning.list — browse a project's learnings ranked by reuse success then recency (the picker
 * for the provenance view). In-scope (RLS) + explicit project_id filter. No keyword (that's
 * learning.query). Never returns embedding.
 */
import { and, desc, eq } from "drizzle-orm";
import type { LearningListInput } from "@memos/shared";
import type { IntentContext } from "../core/context.js";
import { ERROR_TYPE, fail, ok, type Envelope } from "../core/envelope.js";
import { learnings } from "../db/schema.js";

export async function learningList(ctx: IntentContext, input: LearningListInput): Promise<Envelope> {
  const agent = ctx.agent;
  const withScope = ctx.withScope;
  if (!agent || !withScope) return fail("authentication required", ERROR_TYPE.unauthorized);

  const { project_id, limit } = input;
  if (!agent.scopes.includes(project_id)) {
    return fail(`project ${project_id} is not in scope`, ERROR_TYPE.forbidden);
  }

  const rows = await withScope((tx) =>
    tx
      .select({
        id: learnings.id,
        claim: learnings.claim,
        confidence: learnings.confidence,
        appliesTo: learnings.appliesTo,
        reuseSuccessCount: learnings.reuseSuccessCount,
        evidenceArtifactId: learnings.evidenceArtifactId,
      })
      .from(learnings)
      .where(and(eq(learnings.status, "active"), eq(learnings.projectId, project_id)))
      .orderBy(desc(learnings.reuseSuccessCount), desc(learnings.createdAt))
      .limit(limit),
  );

  return ok({
    learnings: rows.map((r) => ({
      id: r.id,
      claim: r.claim,
      confidence: r.confidence,
      applies_to: r.appliesTo,
      reuse_success_count: r.reuseSuccessCount,
      has_evidence: r.evidenceArtifactId !== null,
    })),
  });
}

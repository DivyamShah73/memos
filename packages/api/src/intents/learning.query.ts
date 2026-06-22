/**
 * learning.query — keyword full-text search over a project's learnings, ranked by relevance
 * then reuse success then recency, with an optional applies_to tag filter (array overlap).
 * Runs inside withScope (RLS) + explicit project_id filter. Never returns `embedding`.
 */
import { and, arrayOverlaps, desc, eq, sql } from "drizzle-orm";
import type { LearningQueryInput } from "@memos/shared";
import type { IntentContext } from "../core/context.js";
import { ERROR_TYPE, fail, ok, type Envelope } from "../core/envelope.js";
import { ftsQuery, ftsRank, ftsVector } from "./_fts.js";
import { learnings } from "../db/schema.js";

export async function learningQuery(
  ctx: IntentContext,
  input: LearningQueryInput,
): Promise<Envelope> {
  const agent = ctx.agent;
  const withScope = ctx.withScope;
  if (!agent || !withScope) return fail("authentication required", ERROR_TYPE.unauthorized);

  const { project_id, query, applies_to, limit } = input;
  if (!agent.scopes.includes(project_id)) {
    return fail(`project ${project_id} is not in scope`, ERROR_TYPE.forbidden);
  }

  // SELECT under RLS yields 0 rows for out-of-scope projects — it never raises 42501 (only a
  // write WITH CHECK or a revoked GRANT does), so there's no RLS-violation case to catch here.
  const rows = await withScope((tx) =>
    tx
      .select({
        id: learnings.id,
        claim: learnings.claim,
        appliesTo: learnings.appliesTo,
        confidence: learnings.confidence,
        dokGrade: learnings.dokGrade,
        reuseCount: learnings.reuseCount,
        reuseSuccessCount: learnings.reuseSuccessCount,
        nonObviousMarker: learnings.nonObviousMarker,
        createdAt: learnings.createdAt,
        score: ftsRank(learnings.claim, query),
      })
      .from(learnings)
      .where(
        and(
          eq(learnings.status, "active"),
          eq(learnings.projectId, project_id),
          sql`${ftsVector(learnings.claim)} @@ ${ftsQuery(query)}`,
          applies_to && applies_to.length > 0
            ? arrayOverlaps(learnings.appliesTo, applies_to)
            : undefined,
        ),
      )
      .orderBy(
        desc(ftsRank(learnings.claim, query)),
        desc(learnings.reuseSuccessCount),
        desc(learnings.createdAt),
      )
      .limit(limit),
  );

  return ok({
    learnings: rows.map((r) => ({
      id: r.id,
      claim: r.claim,
      applies_to: r.appliesTo,
      confidence: r.confidence,
      dok_grade: r.dokGrade,
      reuse_count: r.reuseCount,
      reuse_success_count: r.reuseSuccessCount,
      non_obvious_marker: r.nonObviousMarker,
      created_at: r.createdAt,
      score: r.score,
    })),
  });
}

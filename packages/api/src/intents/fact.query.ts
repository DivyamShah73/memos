/**
 * fact.query — keyword full-text search over a project's facts. Runs inside withScope (RLS),
 * with an explicit project_id filter (RLS permits all the agent's projects; this targets one).
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { FactQueryInput } from "@memos/shared";
import type { IntentContext } from "../core/context.js";
import { ERROR_TYPE, fail, ok, type Envelope } from "../core/envelope.js";
import { ftsQuery, ftsRank, ftsVector } from "./_fts.js";
import { facts } from "../db/schema.js";

export async function factQuery(ctx: IntentContext, input: FactQueryInput): Promise<Envelope> {
  const agent = ctx.agent;
  const withScope = ctx.withScope;
  if (!agent || !withScope) return fail("authentication required", ERROR_TYPE.unauthorized);

  const { project_id, query, limit } = input;
  if (!agent.scopes.includes(project_id)) {
    return fail(`project ${project_id} is not in scope`, ERROR_TYPE.forbidden);
  }

  // SELECT under RLS yields 0 rows for out-of-scope projects — it never raises 42501 (only a
  // write WITH CHECK or a revoked GRANT does), so there's no RLS-violation case to catch here.
  const rows = await withScope((tx) =>
    tx
      .select({
        id: facts.id,
        claim: facts.claim,
        confidence: facts.confidence,
        bdId: facts.bdId,
        createdAt: facts.createdAt,
        score: ftsRank(facts.claim, query),
      })
      .from(facts)
      .where(
        and(
          eq(facts.status, "active"),
          eq(facts.projectId, project_id),
          sql`${ftsVector(facts.claim)} @@ ${ftsQuery(query)}`,
        ),
      )
      .orderBy(desc(ftsRank(facts.claim, query)), desc(facts.createdAt))
      .limit(limit),
  );

  return ok({
    facts: rows.map((r) => ({
      id: r.id,
      claim: r.claim,
      confidence: r.confidence,
      bd_id: r.bdId,
      created_at: r.createdAt,
      score: r.score,
    })),
  });
}

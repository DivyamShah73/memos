/**
 * checkin — records a state change on a workflow run (start→…→complete/failed). Terminal
 * statuses close the run. The run lookup runs inside the agent's RLS scope (another tenant's
 * run is invisible → "unknown workflow run") and `FOR UPDATE` serializes concurrent checkins
 * so two terminal ones can't double-close.
 *
 * The objective rule derives from the RUN's binding (fixed at creation), NOT the live
 * `projects.okrs_required` flag — so flipping that flag can never strand an open run.
 */
import { and, eq, sql } from "drizzle-orm";
import type { CheckinInput } from "@memos/shared";
import type { IntentContext } from "../core/context.js";
import { ERROR_TYPE, fail, ok, type Envelope } from "../core/envelope.js";
import { isRlsViolation } from "../core/pgerrors.js";
import { publishActivity } from "../core/events.js";
import { checkins, workflowRuns } from "../db/schema.js";

type TxResult = { kind: "error"; message: string } | { kind: "ok"; checkinId: string };

export async function checkin(ctx: IntentContext, input: CheckinInput): Promise<Envelope> {
  const agent = ctx.agent;
  const withScope = ctx.withScope;
  if (!agent || !withScope) return fail("authentication required", ERROR_TYPE.unauthorized);

  const { project_id, bd_id, status, current_task, target_objective_id } = input;

  if (!agent.scopes.includes(project_id)) {
    return fail(`project ${project_id} is not in scope`, ERROR_TYPE.forbidden);
  }

  // uuid columns read back canonical lowercase; normalize the input so the match is
  // case-insensitive (z.string().uuid() accepts upper/mixed case unchanged).
  const want = target_objective_id ? target_objective_id.toLowerCase() : null;

  try {
    const result: TxResult = await withScope(async (tx): Promise<TxResult> => {
      // FOR UPDATE locks the run row for this tx: a concurrent terminal checkin blocks here
      // until we commit, then sees status='complete' → "already closed" (closes the TOCTOU).
      // RLS USING still hides another tenant's run (0 rows → "unknown workflow run").
      const runs = await tx
        .select({
          projectId: workflowRuns.projectId,
          status: workflowRuns.status,
          targetObjectiveId: workflowRuns.targetObjectiveId,
        })
        .from(workflowRuns)
        .where(eq(workflowRuns.bdId, bd_id))
        .for("update")
        .limit(1);
      if (runs.length === 0) return { kind: "error", message: "unknown workflow run" };
      const run = runs[0];
      // An agent scoped to >1 project must not checkin under project A against a B run.
      if (run.projectId !== project_id) return { kind: "error", message: "unknown workflow run" };
      if (run.status !== "open") return { kind: "error", message: "workflow run already closed" };

      if (run.targetObjectiveId !== null) {
        // Bound run: the checkin must repeat the run's objective (hard rule #2).
        if (want === null) return { kind: "error", message: "target_objective_id is required for this run" };
        if (want !== run.targetObjectiveId) {
          return { kind: "error", message: "target_objective_id does not match the run's objective" };
        }
      } else if (want !== null) {
        return { kind: "error", message: "this run is not bound to an objective" };
      }

      // Store the run's canonical objective (always a valid, in-project objective), so the
      // checkin's provenance column can never drift or point at a foreign/garbage id.
      const inserted = await tx
        .insert(checkins)
        .values({
          bdId: bd_id,
          projectId: project_id,
          targetObjectiveId: run.targetObjectiveId,
          status,
          currentTask: current_task ?? null,
        })
        .returning({ id: checkins.id });

      if (status === "complete" || status === "failed") {
        // Conditional on status='open' as a second guard alongside FOR UPDATE.
        await tx
          .update(workflowRuns)
          .set({ status, closedAt: sql`now()` })
          .where(and(eq(workflowRuns.bdId, bd_id), eq(workflowRuns.status, "open")));
      }
      return { kind: "ok", checkinId: inserted[0].id };
    });

    if (result.kind === "error") return fail(result.message, ERROR_TYPE.badRequest);

    // Post-commit: surface the state change on the live activity feed (Phase 7).
    publishActivity({
      type: "checkin",
      projectId: project_id,
      agentId: agent.id,
      summary: current_task ? `${status} — ${current_task}` : status,
      ts: new Date().toISOString(),
      bdId: bd_id,
    });
    return ok({
      checkin_id: result.checkinId,
      accepted_facts: 0,
      rejected_facts: [],
      recorded_learnings: 0,
      recorded_uses: 0,
    });
  } catch (err) {
    if (isRlsViolation(err)) {
      return fail(`project ${project_id} is not in scope`, ERROR_TYPE.forbidden);
    }
    throw err;
  }
}

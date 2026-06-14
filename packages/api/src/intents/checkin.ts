/**
 * checkin — records a state change on a workflow run (start→…→complete/failed). Terminal
 * statuses close the run. The run lookup runs inside the agent's RLS scope, so another
 * tenant's run is invisible ("unknown workflow run").
 */
import { eq, sql } from "drizzle-orm";
import type { CheckinInput } from "@memos/shared";
import type { IntentContext } from "../core/context.js";
import { ERROR_TYPE, fail, ok, type Envelope } from "../core/envelope.js";
import { isRlsViolation } from "../core/pgerrors.js";
import { checkins, projects, workflowRuns } from "../db/schema.js";

type TxResult = { kind: "error"; message: string } | { kind: "ok"; checkinId: string };

export async function checkin(ctx: IntentContext, input: CheckinInput): Promise<Envelope> {
  const agent = ctx.agent;
  const withScope = ctx.withScope;
  if (!agent || !withScope) return fail("authentication required", ERROR_TYPE.unauthorized);

  const { project_id, bd_id, status, current_task, target_objective_id } = input;

  if (!agent.scopes.includes(project_id)) {
    return fail(`project ${project_id} is not in scope`, ERROR_TYPE.forbidden);
  }

  const proj = await ctx.db
    .select({ okrsRequired: projects.okrsRequired })
    .from(projects)
    .where(eq(projects.id, project_id))
    .limit(1);
  if (proj.length === 0) return fail("unknown project", ERROR_TYPE.badRequest);
  const okrsRequired = proj[0].okrsRequired;

  try {
    const result: TxResult = await withScope(async (tx): Promise<TxResult> => {
      // RLS USING makes another tenant's run invisible → 0 rows → "unknown workflow run".
      const runs = await tx
        .select({
          projectId: workflowRuns.projectId,
          status: workflowRuns.status,
          targetObjectiveId: workflowRuns.targetObjectiveId,
        })
        .from(workflowRuns)
        .where(eq(workflowRuns.bdId, bd_id))
        .limit(1);
      if (runs.length === 0) return { kind: "error", message: "unknown workflow run" };
      const run = runs[0];
      // An agent scoped to >1 project must not checkin under project A against a run in B.
      if (run.projectId !== project_id) return { kind: "error", message: "unknown workflow run" };
      if (run.status !== "open") return { kind: "error", message: "workflow run already closed" };

      // Hard rule #2: every checkin on an okrs_required project repeats the run's objective.
      if (okrsRequired && (!target_objective_id || target_objective_id !== run.targetObjectiveId)) {
        return { kind: "error", message: "target_objective_id is required on this project" };
      }

      const inserted = await tx
        .insert(checkins)
        .values({
          bdId: bd_id,
          projectId: project_id,
          targetObjectiveId: target_objective_id ?? null,
          status,
          currentTask: current_task ?? null,
        })
        .returning({ id: checkins.id });

      // Terminal status closes the run (atomically with the checkin).
      if (status === "complete" || status === "failed") {
        await tx
          .update(workflowRuns)
          .set({ status, closedAt: sql`now()` })
          .where(eq(workflowRuns.bdId, bd_id));
      }
      return { kind: "ok", checkinId: inserted[0].id };
    });

    if (result.kind === "error") return fail(result.message, ERROR_TYPE.badRequest);
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

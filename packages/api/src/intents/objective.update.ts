/**
 * objective.update — patch a mutable field on an objective or transition its status
 * (active|achieved|abandoned|superseded). In-scope (RLS) + explicit project_id filter, so you
 * can only touch your own project's objectives. Abandoning here is what later blocks binding
 * (workflow.create rejects an abandoned target_objective_id).
 */
import { and, eq } from "drizzle-orm";
import type { ObjectiveUpdateInput } from "@memos/shared";
import type { IntentContext } from "../core/context.js";
import { ERROR_TYPE, fail, ok, type Envelope } from "../core/envelope.js";
import { isRlsViolation } from "../core/pgerrors.js";
import { objectives } from "../db/schema.js";

type TxResult = { kind: "validation"; message: string } | { kind: "updated"; status: string };

export async function objectiveUpdate(
  ctx: IntentContext,
  input: ObjectiveUpdateInput,
): Promise<Envelope> {
  const agent = ctx.agent;
  const withScope = ctx.withScope;
  if (!agent || !withScope) return fail("authentication required", ERROR_TYPE.unauthorized);

  const { project_id, objective_id, title, description, target_completion, weight, status } = input;
  if (!agent.scopes.includes(project_id)) {
    return fail(`project ${project_id} is not in scope`, ERROR_TYPE.forbidden);
  }

  try {
    const result = await withScope(async (tx): Promise<TxResult> => {
      const found = await tx
        .select({ id: objectives.id })
        .from(objectives)
        .where(and(eq(objectives.id, objective_id), eq(objectives.projectId, project_id)))
        .limit(1);
      if (found.length === 0) {
        return { kind: "validation", message: "objective not found in this project" };
      }

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (title !== undefined) patch.title = title;
      if (description !== undefined) patch.description = description;
      if (target_completion !== undefined) patch.targetCompletion = new Date(target_completion);
      if (weight !== undefined) patch.weight = String(weight);
      if (status !== undefined) patch.status = status;

      const [row] = await tx
        .update(objectives)
        .set(patch)
        .where(and(eq(objectives.id, objective_id), eq(objectives.projectId, project_id)))
        .returning({ status: objectives.status });
      return { kind: "updated", status: row.status };
    });

    if (result.kind === "validation") return fail(result.message, ERROR_TYPE.badRequest);
    return ok({ objective_id, status: result.status });
  } catch (err) {
    if (isRlsViolation(err)) {
      return fail(`project ${project_id} is not in scope`, ERROR_TYPE.forbidden);
    }
    throw err;
  }
}

/**
 * workflow.create — opens a unit of agent work and returns a bd_id (the provenance spine
 * every fact/learning/artifact/checkin threads onto). On okrs_required projects it must bind
 * to a non-abandoned objective in the project.
 */
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { WorkflowCreateInput } from "@memos/shared";
import type { IntentContext } from "../core/context.js";
import { ERROR_TYPE, fail, ok, type Envelope } from "../core/envelope.js";
import { isRlsViolation, isUniqueViolation } from "../core/pgerrors.js";
import { objectives, projects, workflowRuns } from "../db/schema.js";

function newBdId(): string {
  return "memos-" + randomBytes(4).toString("hex"); // memos-<8 hex>
}

type TxResult = { kind: "validation"; message: string } | { kind: "created" };

export async function workflowCreate(
  ctx: IntentContext,
  input: WorkflowCreateInput,
): Promise<Envelope> {
  const agent = ctx.agent;
  const withScope = ctx.withScope;
  if (!agent || !withScope) return fail("authentication required", ERROR_TYPE.unauthorized);

  const { project_id, workflow_class, title, target_objective_id } = input;

  // Scope check (defense in depth). The RLS WITH CHECK is the real guard, but an out-of-scope
  // INSERT throws 42501 → 500, so this pre-check gives the agent a clean 403 instead.
  if (!agent.scopes.includes(project_id)) {
    return fail(`project ${project_id} is not in scope`, ERROR_TYPE.forbidden);
  }

  // projects is control-plane (no RLS) — read with the raw client.
  const proj = await ctx.db
    .select({ okrsRequired: projects.okrsRequired })
    .from(projects)
    .where(eq(projects.id, project_id))
    .limit(1);
  if (proj.length === 0) return fail("unknown project", ERROR_TYPE.badRequest);
  const okrsRequired = proj[0].okrsRequired;

  // bd_id collision retry must re-open the transaction: a 23505 inside a tx aborts the whole
  // tx ("commands ignored until end of transaction block"), so we can't retry within it.
  for (let attempt = 0; attempt < 3; attempt++) {
    const bdId = newBdId();
    try {
      const result: TxResult = await withScope(async (tx): Promise<TxResult> => {
        // Validate the objective WHENEVER one is supplied — on any project, not just
        // okrs_required. objectives IS RLS'd, so this in-scope read makes a foreign-tenant
        // objective invisible (→ "not found", no cross-tenant binding) and turns a
        // non-existent id into a clean business error instead of an FK 23503 → 500. A
        // missing and a foreign objective are indistinguishable here (both 0 rows) — by
        // design: one message, no cross-tenant existence leak.
        if (target_objective_id) {
          const obj = await tx
            .select({ status: objectives.status })
            .from(objectives)
            .where(and(eq(objectives.id, target_objective_id), eq(objectives.projectId, project_id)))
            .limit(1);
          if (obj.length === 0) {
            return { kind: "validation", message: "target_objective_id not found in this project" };
          }
          if (obj[0].status === "abandoned") {
            return { kind: "validation", message: "target_objective_id is abandoned; cannot bind" };
          }
        }
        if (okrsRequired && !target_objective_id) {
          return { kind: "validation", message: "target_objective_id is required on this project" };
        }

        await tx.insert(workflowRuns).values({
          bdId,
          projectId: project_id,
          agentId: agent.id,
          workflowClass: workflow_class,
          title,
          targetObjectiveId: target_objective_id ?? null,
        });
        return { kind: "created" };
      });

      if (result.kind === "validation") return fail(result.message, ERROR_TYPE.badRequest);
      return ok({ bd_id: bdId });
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 2) continue; // bd_id collision → new id, new tx
      if (isRlsViolation(err)) {
        return fail(`project ${project_id} is not in scope`, ERROR_TYPE.forbidden);
      }
      throw err;
    }
  }
  return fail("could not allocate a unique bd_id", ERROR_TYPE.platform);
}

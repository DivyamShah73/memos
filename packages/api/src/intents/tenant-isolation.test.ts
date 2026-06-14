/**
 * The core multi-tenancy proof: an agent scoped to project A cannot create or read another
 * project's work, enforced at the DB by RLS. Also proves the per-request GUC is actually
 * doing the gating — otherwise the isolation could pass for the wrong reason (a silently
 * unset GUC makes every read empty, which looks like "no data," not "broken auth").
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  call,
  cleanupAndClose,
  enrollAgent,
  seedBase,
  seedObjective,
  seedProject,
} from "../_testutil.js";
import { gatewayDb } from "../db/gateway.js";
import { makeWithScope } from "../core/scope.js";
import { workflowRuns } from "../db/schema.js";

const A = "project.vitest-a";
const B = "project.vitest-b";
let tokenA: string;
let tokenB: string;
let bdInA: string;

beforeAll(async () => {
  await seedBase();
  await seedProject(A, false);
  await seedProject(B, false);
  tokenA = await enrollAgent([A], "vitest-iso-a");
  tokenB = await enrollAgent([B], "vitest-iso-b");
  const { json } = await call("workflow.create", tokenA, {
    project_id: A,
    workflow_class: "investigation",
    title: "A's run",
  });
  bdInA = json.data.bd_id;
});

afterAll(async () => {
  await cleanupAndClose([A, B]);
});

describe("tenant isolation", () => {
  it("agent A cannot create a workflow in project B (403)", async () => {
    const { status, json } = await call("workflow.create", tokenA, {
      project_id: B,
      workflow_class: "x",
      title: "intrusion",
    });
    expect(status).toBe(403);
    expect(json.error_type).toBe("forbidden");
  });

  it("agent B cannot checkin on A's run — RLS hides it (unknown workflow run)", async () => {
    // B supplies A's real bd_id under B's own (in-scope) project; RLS makes the run invisible.
    const { json } = await call("checkin", tokenB, {
      project_id: B,
      bd_id: bdInA,
      status: "start",
    });
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/unknown workflow run/);
  });

  it("agent A cannot bind a project-B objective (foreign objective is invisible → not found)", async () => {
    // B's objective exists globally (FK would pass), but it's RLS-invisible to A's scope,
    // so the in-scope validation rejects it — no cross-tenant provenance binding.
    const bObjective = await seedObjective(B, "active");
    const { json } = await call("workflow.create", tokenA, {
      project_id: A, // okrs_required = false — the path that used to skip validation
      workflow_class: "x",
      title: "cross-bind attempt",
      target_objective_id: bObjective,
    });
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/not found in this project/);
  });

  it("GUC proof: a gateway read of A's run with NO scope set returns nothing (default-deny)", async () => {
    const rows = await gatewayDb
      .select({ bdId: workflowRuns.bdId })
      .from(workflowRuns)
      .where(eq(workflowRuns.bdId, bdInA));
    expect(rows).toHaveLength(0);
  });

  it("GUC proof: a gateway read WITH project A's scope returns the run (the GUC gates it)", async () => {
    const rows = await makeWithScope(gatewayDb, [A])((tx) =>
      tx.select({ bdId: workflowRuns.bdId }).from(workflowRuns).where(eq(workflowRuns.bdId, bdInA)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].bdId).toBe(bdInA);
  });
});

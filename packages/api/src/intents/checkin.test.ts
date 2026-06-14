import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  call,
  cleanupAndClose,
  enrollAgent,
  ownerDb,
  seedBase,
  seedObjective,
  seedProject,
} from "../_testutil.js";
import { workflowRuns } from "../db/schema.js";

const P = "project.vitest-ck"; // okrs_required = false
const P_OKR = "project.vitest-ck-okr"; // okrs_required = true
let token: string;
let objId: string;

beforeAll(async () => {
  await seedBase();
  await seedProject(P, false);
  await seedProject(P_OKR, true);
  objId = await seedObjective(P_OKR, "active");
  token = await enrollAgent([P, P_OKR], "vitest-ck");
});

afterAll(async () => {
  await cleanupAndClose([P, P_OKR]);
});

async function openRun(project = P, objective?: string): Promise<string> {
  const { json } = await call("workflow.create", token, {
    project_id: project,
    workflow_class: "investigation",
    title: "run",
    target_objective_id: objective,
  });
  return json.data.bd_id as string;
}

describe("checkin", () => {
  it("records start then complete and moves the run to complete + closed_at", async () => {
    const bd = await openRun();
    const start = await call("checkin", token, {
      project_id: P,
      bd_id: bd,
      status: "start",
      current_task: "begin",
    });
    expect(start.json.ok).toBe(true);
    expect(start.json.data.checkin_id).toBeTruthy();
    // forward-compatible counters present
    expect(start.json.data.accepted_facts).toBe(0);

    const complete = await call("checkin", token, {
      project_id: P,
      bd_id: bd,
      status: "complete",
      current_task: "done",
    });
    expect(complete.json.ok).toBe(true);

    const [run] = await ownerDb
      .select({ status: workflowRuns.status, closedAt: workflowRuns.closedAt })
      .from(workflowRuns)
      .where(eq(workflowRuns.bdId, bd));
    expect(run.status).toBe("complete");
    expect(run.closedAt).not.toBeNull();
  });

  it("rejects a checkin on an unknown bd_id", async () => {
    const { json } = await call("checkin", token, {
      project_id: P,
      bd_id: "memos-deadbeef",
      status: "start",
    });
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/unknown workflow run/);
  });

  it("rejects a checkin on an already-closed run", async () => {
    const bd = await openRun();
    await call("checkin", token, { project_id: P, bd_id: bd, status: "complete" });
    const { json } = await call("checkin", token, { project_id: P, bd_id: bd, status: "progress" });
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/already closed/);
  });

  it("serializes concurrent terminal checkins — exactly one closes the run", async () => {
    const bd = await openRun();
    await call("checkin", token, { project_id: P, bd_id: bd, status: "start" });
    const [a, b] = await Promise.all([
      call("checkin", token, { project_id: P, bd_id: bd, status: "complete" }),
      call("checkin", token, { project_id: P, bd_id: bd, status: "complete" }),
    ]);
    const oks = [a, b].filter((r) => r.json.ok === true).length;
    const closed = [a, b].filter(
      (r) => r.json.ok === false && /already closed/.test(r.json.error),
    ).length;
    expect(oks).toBe(1);
    expect(closed).toBe(1);
  });

  it("requires the matching target_objective_id on okrs_required projects", async () => {
    const bd = await openRun(P_OKR, objId);
    const missing = await call("checkin", token, { project_id: P_OKR, bd_id: bd, status: "start" });
    expect(missing.json.ok).toBe(false);
    expect(missing.json.error).toMatch(/required/);

    const okCheckin = await call("checkin", token, {
      project_id: P_OKR,
      bd_id: bd,
      status: "start",
      target_objective_id: objId,
    });
    expect(okCheckin.json.ok).toBe(true);
  });
});

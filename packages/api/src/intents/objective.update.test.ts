import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  cleanupAndClose,
  enrollAgent,
  seedBase,
  seedObjective,
  seedProject,
} from "../_testutil.js";

const A = "project.vitest-ou";
const B = "project.vitest-ou-other";
let token: string;

beforeAll(async () => {
  await seedBase();
  await seedProject(A, false);
  await seedProject(B, false);
  token = await enrollAgent([A], "vitest-ou");
});

afterAll(async () => {
  await cleanupAndClose([A, B]);
});

describe("objective.update", () => {
  it("patches a mutable field", async () => {
    const id = await seedObjective(A, { title: "old" });
    const { status, json } = await call("objective.update", token, {
      project_id: A,
      objective_id: id,
      title: "new title",
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.objective_id).toBe(id);
  });

  it("transitions status to abandoned, after which workflow.create can't bind to it", async () => {
    const id = await seedObjective(A, { title: "to abandon" });
    const upd = await call("objective.update", token, {
      project_id: A,
      objective_id: id,
      status: "abandoned",
    });
    expect(upd.json.data.status).toBe("abandoned");

    // Re-verify the Phase-2 invariant cross-phase: an abandoned objective cannot be bound.
    const wf = await call("workflow.create", token, {
      project_id: A,
      workflow_class: "investigation",
      title: "bind attempt",
      target_objective_id: id,
    });
    expect(wf.json.ok).toBe(false);
    expect(wf.json.error).toMatch(/abandoned; cannot bind/);
  });

  it("rejects an objective not in this project (ok:false)", async () => {
    const foreign = await seedObjective(B);
    const { status, json } = await call("objective.update", token, {
      project_id: A,
      objective_id: foreign,
      status: "achieved",
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/not found in this project/);
  });

  it("rejects an out-of-scope project (403)", async () => {
    const id = await seedObjective(B);
    const { status } = await call("objective.update", token, {
      project_id: B,
      objective_id: id,
      status: "achieved",
    });
    expect(status).toBe(403);
  });
});

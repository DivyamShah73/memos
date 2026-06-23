import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  cleanupAndClose,
  enrollAgent,
  seedBase,
  seedObjective,
  seedProject,
  seedWorkflowRun,
} from "../_testutil.js";

const A = "project.vitest-op";
const B = "project.vitest-op-other";
let token: string;
let bd: string;

beforeAll(async () => {
  await seedBase();
  await seedProject(A, false);
  await seedProject(B, false);
  token = await enrollAgent([A], "vitest-op", "manager"); // objective.publish is manager-gated (ADR-010)
  bd = await seedWorkflowRun(A);
});

afterAll(async () => {
  await cleanupAndClose([A, B]);
});

describe("objective.publish", () => {
  it("publishes a flat objective with inline milestones", async () => {
    const { status, json } = await call("objective.publish", token, {
      project_id: A,
      bd_id: bd,
      title: "Ship the thing",
      milestones: [
        { title: "KR1", metric_target: 90, metric_current: 0, metric_direction: "up" },
        { title: "plain milestone" },
      ],
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.objective_id).toBeDefined();
    expect(json.data.milestone_ids).toHaveLength(2);
  });

  it("publishes a sub-OKR under a parent (parent_id + weight)", async () => {
    const parent = await seedObjective(A, { title: "parent" });
    const { json } = await call("objective.publish", token, {
      project_id: A,
      bd_id: bd,
      title: "child",
      parent_id: parent,
      weight: 3,
    });
    expect(json.ok).toBe(true);
  });

  it("rejects a parent that isn't in this project (ok:false)", async () => {
    const foreign = await seedObjective(B); // exists, but in project B
    const { status, json } = await call("objective.publish", token, {
      project_id: A,
      bd_id: bd,
      title: "orphan",
      parent_id: foreign,
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/parent_id not found/);
  });

  it("rejects an abandoned parent", async () => {
    const dead = await seedObjective(A, { status: "abandoned" });
    const { json } = await call("objective.publish", token, {
      project_id: A,
      bd_id: bd,
      title: "child of the dead",
      parent_id: dead,
    });
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/abandoned; cannot nest/);
  });

  it("rejects an unknown workflow run (ok:false)", async () => {
    const { json } = await call("objective.publish", token, {
      project_id: A,
      bd_id: "memos-deadbeef",
      title: "no run",
    });
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/unknown workflow run/);
  });

  it("rejects an out-of-scope project (403)", async () => {
    const { status } = await call("objective.publish", token, {
      project_id: B,
      bd_id: bd,
      title: "nope",
    });
    expect(status).toBe(403);
  });
});

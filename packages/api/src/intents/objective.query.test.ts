import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  cleanupAndClose,
  enrollAgent,
  seedBase,
  seedMilestone,
  seedObjective,
  seedProject,
} from "../_testutil.js";

const A = "project.vitest-oq";
const B = "project.vitest-oq-other";
let token: string;
let parent: string;
let bObjective: string;

beforeAll(async () => {
  await seedBase();
  await seedProject(A, false);
  await seedProject(B, false);
  token = await enrollAgent([A], "vitest-oq");

  // Parent with two weighted leaf children (3:1) plus an abandoned child that must NOT count.
  parent = await seedObjective(A, { title: "parent" });
  const c1 = await seedObjective(A, { parentId: parent, weight: 3 }); // → progress 1.0
  const c2 = await seedObjective(A, { parentId: parent, weight: 1 }); // → progress 0.0
  const cAband = await seedObjective(A, { parentId: parent, weight: 100, status: "abandoned" });
  await seedMilestone(A, c1, { metricTarget: 100, metricCurrent: 100, metricDirection: "up" });
  await seedMilestone(A, c2, { metricTarget: 100, metricCurrent: 0, metricDirection: "up" });
  await seedMilestone(A, cAband, { metricTarget: 100, metricCurrent: 100, metricDirection: "up" });

  bObjective = await seedObjective(B, { title: "B root" });
});

afterAll(async () => {
  await cleanupAndClose([A, B]);
});

describe("objective.query", () => {
  it("rolls child progress up by weight, excluding abandoned children", async () => {
    const { status, json } = await call("objective.query", token, {
      project_id: A,
      objective_id: parent,
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    const root = json.data.objectives[0];
    // (3×1.0 + 1×0.0) / (3+1) = 0.75; the abandoned weight-100 child is excluded.
    expect(root.progress).toBeCloseTo(0.75, 5);
    expect(root.children.length).toBe(3); // tree still shows the abandoned child
  });

  it("returns root objectives when no objective_id is given", async () => {
    const { json } = await call("objective.query", token, { project_id: A });
    const ids: string[] = json.data.objectives.map((o: any) => o.id);
    expect(ids).toContain(parent);
    expect(ids.every((id) => id !== bObjective)).toBe(true); // never project B's
  });

  it("is project-scoped: querying B (out of scope) is 403", async () => {
    const { status } = await call("objective.query", token, { project_id: B });
    expect(status).toBe(403);
  });

  it("surfaces per-milestone progress fields", async () => {
    const { json } = await call("objective.query", token, {
      project_id: A,
      objective_id: parent,
    });
    const child = json.data.objectives[0].children.find((c: any) => c.progress === 1);
    expect(child.milestones[0]).toHaveProperty("metric_target", 100);
    expect(child.milestones[0]).toHaveProperty("progress", 1);
  });

  it("a never-measured down-direction KR is 0%, not 100%", async () => {
    // Regression: a 'down' KR with no metric_current must not read as achieved (0 <= target).
    const obj = await seedObjective(A, { title: "fresh down" });
    await seedMilestone(A, obj, { metricTarget: 200, metricDirection: "down" }); // no current
    const { json } = await call("objective.query", token, { project_id: A, objective_id: obj });
    expect(json.data.objectives[0].milestones[0].progress).toBe(0);
    expect(json.data.objectives[0].progress).toBe(0);
  });
});

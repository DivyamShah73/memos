import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  cleanupAndClose,
  enrollAgent,
  seedMilestone,
  seedObjective,
  seedBase,
  seedProject,
} from "../_testutil.js";

const A = "project.vitest-kr";
let token: string;
let upKr: string;
let downKr: string;
let plain: string;

beforeAll(async () => {
  await seedBase();
  await seedProject(A, false);
  token = await enrollAgent([A], "vitest-kr");
  const obj = await seedObjective(A, { title: "kr obj" });
  upKr = await seedMilestone(A, obj, { metricTarget: 90, metricCurrent: 0, metricDirection: "up" });
  downKr = await seedMilestone(A, obj, {
    metricTarget: 50,
    metricCurrent: 200,
    metricDirection: "down",
  });
  plain = await seedMilestone(A, obj, { title: "no metric" });
});

afterAll(async () => {
  await cleanupAndClose([A]);
});

describe("key_result.update", () => {
  it("up metric: 45/90 → progress ≈ 0.5", async () => {
    const { status, json } = await call("key_result.update", token, {
      project_id: A,
      milestone_id: upKr,
      metric_current: 45,
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.progress).toBeCloseTo(0.5, 5);
    expect(json.data.metric_current).toBe(45);
  });

  it("down metric (lower is better): current 100 vs target 50 → 0.5", async () => {
    const { json } = await call("key_result.update", token, {
      project_id: A,
      milestone_id: downKr,
      metric_current: 100,
    });
    expect(json.data.progress).toBeCloseTo(0.5, 5);
  });

  it("down metric at/below target → 1.0", async () => {
    const { json } = await call("key_result.update", token, {
      project_id: A,
      milestone_id: downKr,
      metric_current: 40,
    });
    expect(json.data.progress).toBe(1);
  });

  it("rejects a milestone with no metric_target (ok:false)", async () => {
    const { status, json } = await call("key_result.update", token, {
      project_id: A,
      milestone_id: plain,
      metric_current: 10,
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/not a key result/);
  });
});

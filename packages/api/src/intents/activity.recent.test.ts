import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  cleanupAndClose,
  enrollAgent,
  ownerDb,
  seedBase,
  seedFact,
  seedLearning,
  seedProject,
  seedWorkflowRun,
} from "../_testutil.js";
import { checkins } from "../db/schema.js";

const A = "project.vitest-act";
const B = "project.vitest-act-b";
let token: string;

beforeAll(async () => {
  await seedBase();
  await seedProject(A, false);
  await seedProject(B, false);
  token = await enrollAgent([A], "vitest-act");

  const bdA = await seedWorkflowRun(A);
  await seedFact(A, bdA, "deploy latency dropped after warmup");
  await seedLearning(A, bdA, "warmup cuts cold-start tail latency", ["perf"]);
  await ownerDb.insert(checkins).values({ bdId: bdA, projectId: A, status: "progress", currentTask: "profiling" });

  // Another tenant's fact — must never appear in A's feed.
  const bdB = await seedWorkflowRun(B);
  await seedFact(B, bdB, "secret in another tenant");
});

afterAll(async () => {
  await cleanupAndClose([A, B]);
});

describe("activity.recent", () => {
  it("returns a unified, newest-first feed of checkins + facts + learnings", async () => {
    const { status, json } = await call("activity.recent", token, { project_id: A });
    expect(status).toBe(200);
    const types: string[] = json.data.activity.map((a: any) => a.type);
    expect(types).toEqual(expect.arrayContaining(["fact", "learning", "checkin"]));
    // newest-first
    const times = json.data.activity.map((a: any) => new Date(a.created_at).getTime());
    expect([...times].sort((x, y) => y - x)).toEqual(times);
  });

  it("is project-scoped: A's feed never includes project B's items", async () => {
    const { json } = await call("activity.recent", token, { project_id: A });
    expect(json.data.activity.every((a: any) => !/another tenant/.test(a.summary))).toBe(true);
  });

  it("rejects an out-of-scope project (403)", async () => {
    const { status } = await call("activity.recent", token, { project_id: B });
    expect(status).toBe(403);
  });
});

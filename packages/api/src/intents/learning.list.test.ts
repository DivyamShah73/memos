import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  cleanupAndClose,
  enrollAgent,
  seedBase,
  seedLearning,
  seedProject,
  seedWorkflowRun,
} from "../_testutil.js";
import { ownerDb } from "../_testutil.js";
import { learnings } from "../db/schema.js";
import { eq } from "drizzle-orm";

const A = "project.vitest-llist";
const B = "project.vitest-llist-b";
let token: string;

beforeAll(async () => {
  await seedBase();
  await seedProject(A, false);
  await seedProject(B, false);
  token = await enrollAgent([A], "vitest-llist");
  const bd = await seedWorkflowRun(A);
  const hi = await seedLearning(A, bd, "high reuse learning", ["x"]);
  await seedLearning(A, bd, "low reuse learning", ["x"]);
  await ownerDb.update(learnings).set({ reuseSuccessCount: 9 }).where(eq(learnings.id, hi));
  // another tenant's learning — must not appear
  const bdB = await seedWorkflowRun(B);
  await seedLearning(B, bdB, "another tenant learning", ["x"]);
});

afterAll(async () => {
  await cleanupAndClose([A, B]);
});

describe("learning.list", () => {
  it("lists this project's learnings, most-reused first", async () => {
    const { status, json } = await call("learning.list", token, { project_id: A });
    expect(status).toBe(200);
    expect(json.data.learnings.length).toBe(2);
    expect(json.data.learnings[0].claim).toMatch(/high reuse/);
    expect(json.data.learnings[0].reuse_success_count).toBe(9);
    expect(json.data.learnings[0]).toHaveProperty("has_evidence");
    expect(json.data.learnings.every((l: any) => !/another tenant/.test(l.claim))).toBe(true);
  });

  it("rejects an out-of-scope project (403)", async () => {
    const { status } = await call("learning.list", token, { project_id: B });
    expect(status).toBe(403);
  });
});

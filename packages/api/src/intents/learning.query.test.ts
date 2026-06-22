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

const A = "project.vitest-lq";
const B = "project.vitest-lq-other";
let token: string;

beforeAll(async () => {
  await seedBase();
  await seedProject(A, false);
  await seedProject(B, false);
  token = await enrollAgent([A], "vitest-lq");
  const bdA = await seedWorkflowRun(A);
  // "tuning" is shared by L1+L2 so a single-word query matches both (plainto_tsquery ANDs words).
  await seedLearning(A, bdA, "lora rank selection and tuning", ["fine-tuning", "lora"]);
  await seedLearning(A, bdA, "epoch count tuning for small datasets", ["fine-tuning", "epochs"]);
  await seedLearning(A, bdA, "kubernetes pod eviction under memory pressure", ["k8s", "ops"]);
  // Same keyword in project B — proves isolation.
  const bdB = await seedWorkflowRun(B);
  await seedLearning(B, bdB, "lora tuning in another tenant", ["fine-tuning", "lora"]);
});

afterAll(async () => {
  await cleanupAndClose([A, B]);
});

describe("learning.query", () => {
  it("returns the keyword match and not the others", async () => {
    const { status, json } = await call("learning.query", token, { project_id: A, query: "lora" });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    const claims: string[] = json.data.learnings.map((l: any) => l.claim);
    expect(claims.some((c) => /lora/.test(c))).toBe(true);
    expect(claims.some((c) => /kubernetes/.test(c))).toBe(false);
    expect(claims.some((c) => /epoch/.test(c))).toBe(false);
  });

  it("is project-scoped: A's query never returns B's matching learning", async () => {
    const { json } = await call("learning.query", token, { project_id: A, query: "lora" });
    expect(json.data.learnings.every((l: any) => !/another tenant/.test(l.claim))).toBe(true);
    // non-empty also proves the GUC is actually set (not silent default-deny)
    expect(json.data.learnings.length).toBeGreaterThan(0);
  });

  it("returns a descending score and the expected fields (no embedding)", async () => {
    const { json } = await call("learning.query", token, { project_id: A, query: "tuning" });
    expect(json.data.learnings.length).toBe(2);
    const l = json.data.learnings[0];
    expect(l).toHaveProperty("dok_grade");
    expect(l).toHaveProperty("reuse_success_count");
    expect(l).toHaveProperty("score");
    expect(l).not.toHaveProperty("embedding");
    const scores: number[] = json.data.learnings.map((x: any) => x.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("narrows results by an applies_to tag filter", async () => {
    const { json } = await call("learning.query", token, {
      project_id: A,
      query: "tuning",
      applies_to: ["lora"],
    });
    expect(json.data.learnings.length).toBe(1);
    expect(json.data.learnings[0].applies_to).toContain("lora");
  });

  it("respects limit", async () => {
    const { json } = await call("learning.query", token, { project_id: A, query: "tuning", limit: 1 });
    expect(json.data.learnings.length).toBe(1);
  });

  it("rejects a missing query (400 field_errors)", async () => {
    const { status, json } = await call("learning.query", token, { project_id: A });
    expect(status).toBe(400);
    expect(json.detail.field_errors["query"]).toBeDefined();
  });

  it("rejects a whitespace-only query (400) — must not dump the whole project", async () => {
    const { status, json } = await call("learning.query", token, { project_id: A, query: "   " });
    expect(status).toBe(400);
    expect(json.detail.field_errors["query"]).toBeDefined();
  });

  it("rejects an out-of-scope project (403)", async () => {
    const { status } = await call("learning.query", token, { project_id: B, query: "lora" });
    expect(status).toBe(403);
  });
});

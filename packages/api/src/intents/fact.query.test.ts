import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  cleanupAndClose,
  enrollAgent,
  seedBase,
  seedFact,
  seedProject,
  seedWorkflowRun,
} from "../_testutil.js";

const A = "project.vitest-fq";
const B = "project.vitest-fq-other";
let token: string;

beforeAll(async () => {
  await seedBase();
  await seedProject(A, false);
  await seedProject(B, false);
  token = await enrollAgent([A], "vitest-fq");
  const bdA = await seedWorkflowRun(A);
  await seedFact(A, bdA, "deploy latency spiked after the march rollout");
  await seedFact(A, bdA, "lora adapter merge reduced inference cost", "medium");
  await seedFact(A, bdA, "cohort retention dropped in week three");
  const bdB = await seedWorkflowRun(B);
  await seedFact(B, bdB, "lora rollout in another tenant");
});

afterAll(async () => {
  await cleanupAndClose([A, B]);
});

describe("fact.query", () => {
  it("returns the keyword match and not the others", async () => {
    const { status, json } = await call("fact.query", token, { project_id: A, query: "retention" });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.facts.length).toBe(1);
    expect(json.data.facts[0].claim).toMatch(/retention/);
    expect(json.data.facts[0]).toHaveProperty("bd_id");
    expect(json.data.facts[0]).not.toHaveProperty("embedding");
  });

  it("is project-scoped: A's query never returns B's matching fact", async () => {
    const { json } = await call("fact.query", token, { project_id: A, query: "lora" });
    expect(json.data.facts.length).toBe(1); // only A's lora fact
    expect(json.data.facts.every((f: any) => !/another tenant/.test(f.claim))).toBe(true);
  });

  it("rejects a missing query (400)", async () => {
    const { status, json } = await call("fact.query", token, { project_id: A });
    expect(status).toBe(400);
    expect(json.detail.field_errors["query"]).toBeDefined();
  });

  it("rejects an out-of-scope project (403)", async () => {
    const { status } = await call("fact.query", token, { project_id: B, query: "lora" });
    expect(status).toBe(403);
  });
});

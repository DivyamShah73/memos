import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  cleanupAndClose,
  enrollAgent,
  seedBase,
  seedProject,
} from "../_testutil.js";

const A = "project.vitest-qa";
let token: string;

beforeAll(async () => {
  await seedBase();
  await seedProject(A, false);
  token = await enrollAgent([A], "vitest-qa");
});

afterAll(async () => {
  await cleanupAndClose([A]);
});

describe("question.ask", () => {
  it("records an open question", async () => {
    const { status, json } = await call("question.ask", token, {
      project_id: A,
      subject: "deploy",
      body: "which region should we deploy to?",
      urgency: "medium",
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.question_id).toBeDefined();
  });

  it("rejects a missing body (400)", async () => {
    const { status, json } = await call("question.ask", token, { project_id: A });
    expect(status).toBe(400);
    expect(json.detail.field_errors["body"]).toBeDefined();
  });

  it("rejects an out-of-scope project (403)", async () => {
    const { status } = await call("question.ask", token, {
      project_id: "project.nope",
      body: "hi",
    });
    expect(status).toBe(403);
  });
});

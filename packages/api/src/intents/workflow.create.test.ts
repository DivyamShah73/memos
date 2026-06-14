import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  cleanupAndClose,
  enrollAgent,
  seedBase,
  seedObjective,
  seedProject,
} from "../_testutil.js";

const P = "project.vitest-wf"; // okrs_required = false
const P_OKR = "project.vitest-wf-okr"; // okrs_required = true
let token: string;
let activeObj: string;
let abandonedObj: string;

beforeAll(async () => {
  await seedBase();
  await seedProject(P, false);
  await seedProject(P_OKR, true);
  activeObj = await seedObjective(P_OKR, "active");
  abandonedObj = await seedObjective(P_OKR, "abandoned");
  token = await enrollAgent([P, P_OKR], "vitest-wf");
});

afterAll(async () => {
  await cleanupAndClose([P, P_OKR]);
});

describe("workflow.create", () => {
  it("opens a run and returns a memos- bd_id", async () => {
    const { status, json } = await call("workflow.create", token, {
      project_id: P,
      workflow_class: "investigation",
      title: "smoke run",
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.bd_id).toMatch(/^memos-[0-9a-f]{8}$/);
  });

  it("binds a non-abandoned objective on an okrs_required project", async () => {
    const { json } = await call("workflow.create", token, {
      project_id: P_OKR,
      workflow_class: "sft-experiment",
      title: "bound run",
      target_objective_id: activeObj,
    });
    expect(json.ok).toBe(true);
    expect(json.data.bd_id).toMatch(/^memos-/);
  });

  it("rejects an okrs_required workflow with no target_objective_id", async () => {
    const { json } = await call("workflow.create", token, {
      project_id: P_OKR,
      workflow_class: "sft-experiment",
      title: "unbound",
    });
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/required/);
  });

  it("rejects binding an abandoned objective with 'cannot bind'", async () => {
    const { json } = await call("workflow.create", token, {
      project_id: P_OKR,
      workflow_class: "sft-experiment",
      title: "bad bind",
      target_objective_id: abandonedObj,
    });
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/cannot bind/);
  });

  it("validates a supplied objective even on a non-okrs project (clean error, not FK 500)", async () => {
    const { status, json } = await call("workflow.create", token, {
      project_id: P, // okrs_required = false
      workflow_class: "x",
      title: "t",
      target_objective_id: "00000000-0000-4000-8000-000000000000", // valid uuid, doesn't exist
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/not found in this project/);
  });

  it("rejects an out-of-scope project with 403", async () => {
    const { status, json } = await call("workflow.create", token, {
      project_id: "project.vitest-not-mine",
      workflow_class: "x",
      title: "t",
    });
    expect(status).toBe(403);
    expect(json.error_type).toBe("forbidden");
  });
});

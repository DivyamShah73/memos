import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, cleanupAndClose, enrollAgent, seedBase, seedProject } from "../_testutil.js";

const A = "project.vitest-me";
const B = "project.vitest-me-b";
let token: string;

beforeAll(async () => {
  await seedBase();
  await seedProject(A, false);
  await seedProject(B, false);
  token = await enrollAgent([A, B], "vitest-me");
});

afterAll(async () => {
  await cleanupAndClose([A, B]);
});

describe("agent.me", () => {
  it("returns the calling agent's identity + scopes", async () => {
    const { status, json } = await call("agent.me", token, {});
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.agent_id).toMatch(/^agent\./);
    expect(json.data.scopes).toEqual(expect.arrayContaining([A, B]));
    expect(json.data.team_id).toBe("team.vitest");
    expect(json.data.org_id).toBe("org.vitest");
  });

  it("requires auth (401 without a token)", async () => {
    const { status } = await call("agent.me", null, {});
    expect(status).toBe(401);
  });
});

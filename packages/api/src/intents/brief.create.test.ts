import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  cleanupAndClose,
  enrollAgent,
  ownerDb,
  seedBase,
  seedProject,
} from "../_testutil.js";
import { agents } from "../db/schema.js";

const A = "project.vitest-bc";
let operatorToken: string;
let targetToken: string;
let targetAgentId: string;

beforeAll(async () => {
  await seedBase();
  await seedProject(A, false);
  operatorToken = await enrollAgent([A], "vitest-bc-op");
  targetToken = await enrollAgent([A], "vitest-bc-target");
  const [t] = await ownerDb.select({ id: agents.id }).from(agents).where(eq(agents.displayName, "vitest-bc-target"));
  targetAgentId = t.id;
});

afterAll(async () => {
  await cleanupAndClose([A]);
});

describe("brief.create", () => {
  it("an operator authors a brief that round-trips to the target agent", async () => {
    const create = await call("brief.create", operatorToken, {
      target_kind: "agent",
      target_id: targetAgentId,
      title: "Use batch size 32",
      body: "Standing instruction: cap vLLM batch size at 32.",
    });
    expect(create.status).toBe(200);
    expect(create.json.ok).toBe(true);
    expect(create.json.data.brief_id).toBeDefined();

    // The target agent sees it on fetch.
    const fetch = await call("brief.fetch", targetToken, { project_id: A });
    const titles = fetch.json.data.briefs.map((b: any) => b.title);
    expect(titles).toContain("Use batch size 32");
  });

  it("rejects a missing title (400)", async () => {
    const { status, json } = await call("brief.create", operatorToken, {
      target_kind: "agent",
      target_id: targetAgentId,
      body: "no title",
    });
    expect(status).toBe(400);
    expect(json.detail.field_errors["title"]).toBeDefined();
  });
});

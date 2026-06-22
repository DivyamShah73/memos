import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  cleanupAndClose,
  enrollAgent,
  ownerDb,
  seedBase,
  seedBrief,
  seedProject,
} from "../_testutil.js";
import { agents } from "../db/schema.js";

const A = "project.vitest-ba";
let token: string;
let agentId: string;
let briefId: string;

beforeAll(async () => {
  await seedBase();
  await seedProject(A, false);
  token = await enrollAgent([A], "vitest-ba");
  const [a] = await ownerDb.select({ id: agents.id }).from(agents).where(eq(agents.displayName, "vitest-ba"));
  agentId = a.id;
  briefId = await seedBrief("agent", agentId, { title: "ack-me" });
});

afterAll(async () => {
  await cleanupAndClose([A]);
});

describe("brief.ack", () => {
  it("ack removes the brief from the next fetch; include_acked still shows it", async () => {
    const before = await call("brief.fetch", token, { project_id: A });
    expect(before.json.data.briefs.map((b: any) => b.id)).toContain(briefId);

    const ack = await call("brief.ack", token, { brief_id: briefId });
    expect(ack.json.ok).toBe(true);
    expect(ack.json.data.acked).toBe(true);

    const after = await call("brief.fetch", token, { project_id: A });
    expect(after.json.data.briefs.map((b: any) => b.id)).not.toContain(briefId);

    const withAcked = await call("brief.fetch", token, { project_id: A, include_acked: true });
    expect(withAcked.json.data.briefs.map((b: any) => b.id)).toContain(briefId);
  });

  it("acking is idempotent (second ack still ok)", async () => {
    const ack = await call("brief.ack", token, { brief_id: briefId });
    expect(ack.json.ok).toBe(true);
  });

  it("can't ack a brief not targeted at this agent (ok:false)", async () => {
    const foreign = await seedBrief("team", "team.other", { title: "not yours" });
    const { json } = await call("brief.ack", token, { brief_id: foreign });
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/brief not found/);
  });
});

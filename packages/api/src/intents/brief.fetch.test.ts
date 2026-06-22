import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  cleanupAndClose,
  enrollAgent,
  ownerDb,
  seedBase,
  seedBrief,
  seedObjective,
  seedProject,
} from "../_testutil.js";
import { agents } from "../db/schema.js";

const A = "project.vitest-bf";
const B = "project.vitest-bf-other";
let token: string;
let agentId: string;

beforeAll(async () => {
  await seedBase();
  await seedProject(A, false);
  await seedProject(B, false);
  token = await enrollAgent([A, B], "vitest-bf");
  const [a] = await ownerDb.select({ id: agents.id }).from(agents).where(eq(agents.displayName, "vitest-bf"));
  agentId = a.id;

  // Visible to this agent (its identity set: agent.x / team.vitest / org.vitest / project A,B).
  await seedBrief("agent", agentId, { title: "to-agent" });
  await seedBrief("team", "team.vitest", { title: "to-team" });
  await seedBrief("project", A, { title: "to-projectA" });
  await seedBrief("org", "org.vitest", { title: "to-org" });
  // NOT visible: another team (not the agent's identity).
  await seedBrief("team", "team.other", { title: "to-otherteam" });
  // Visible by RLS (agent is scoped to B) but excluded when fetching project A.
  await seedBrief("project", B, { title: "to-projectB" });
  // Supersede chain: old is hidden, new is shown.
  const old = await seedBrief("agent", agentId, { title: "old-brief" });
  await seedBrief("agent", agentId, { title: "new-brief", supersedesId: old });
  // An active OKR in A for active_okrs.
  await seedObjective(A, { title: "active okr" });
});

afterAll(async () => {
  await cleanupAndClose([A, B]);
});

describe("brief.fetch", () => {
  it("returns identity-targeted briefs, excludes other teams, other projects, and superseded", async () => {
    const { status, json } = await call("brief.fetch", token, { project_id: A });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    const titles: string[] = json.data.briefs.map((b: any) => b.title);
    expect(titles).toEqual(
      expect.arrayContaining(["to-agent", "to-team", "to-projectA", "to-org", "new-brief"]),
    );
    expect(titles).not.toContain("to-otherteam"); // another team — RLS identity hides it
    expect(titles).not.toContain("to-projectB"); // project B brief excluded when fetching A
    expect(titles).not.toContain("old-brief"); // superseded
  });

  it("returns the project's active OKRs", async () => {
    const { json } = await call("brief.fetch", token, { project_id: A });
    expect(json.data.active_okrs.length).toBeGreaterThan(0);
    expect(json.data.active_okrs[0]).toHaveProperty("progress");
  });

  it("is project-scoped: an out-of-scope project is 403", async () => {
    const { status } = await call("brief.fetch", token, { project_id: "project.nope" });
    expect(status).toBe(403);
  });
});

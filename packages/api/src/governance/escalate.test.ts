import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupAndClose,
  enrollAgent,
  ownerDb,
  seedBase,
  seedBrief,
  seedProject,
  TEST_TEAM,
} from "../_testutil.js";
import { agents, briefAcks, briefs } from "../db/schema.js";
import { runBriefEscalation } from "./escalate.js";

const A = "project.vitest-esc";
let agentId: string;
let oldUnacked: string;
let oldAcked: string;
let fresh: string;

const HOURS = 60 * 60 * 1000;

beforeAll(async () => {
  await seedBase();
  await seedProject(A, false);
  await enrollAgent([A], "vitest-esc");
  const [a] = await ownerDb.select({ id: agents.id }).from(agents).where(eq(agents.displayName, "vitest-esc"));
  agentId = a.id;

  const old = new Date(Date.now() - 25 * HOURS);
  oldUnacked = await seedBrief("agent", agentId, { title: "stale", effectiveFrom: old });
  oldAcked = await seedBrief("agent", agentId, { title: "stale-but-acked", effectiveFrom: old });
  await ownerDb.insert(briefAcks).values({ briefId: oldAcked, agentId });
  fresh = await seedBrief("agent", agentId, { title: "fresh" }); // effectiveFrom defaults to now
});

afterAll(async () => {
  await cleanupAndClose([A]);
});

describe("runBriefEscalation", () => {
  it("escalates an old unacked agent brief to its team, skipping acked + fresh ones", async () => {
    const r = await runBriefEscalation(new Date(), ownerDb);
    expect(r.escalated).toBeGreaterThanOrEqual(1);

    const teamBriefs = await ownerDb
      .select({ body: briefs.body })
      .from(briefs)
      .where(and(eq(briefs.targetKind, "team"), eq(briefs.targetId, TEST_TEAM)));
    const bodies = teamBriefs.map((b) => b.body).join("\n");
    expect(bodies).toContain(`src=brief:${oldUnacked}`); // escalated
    expect(bodies).not.toContain(`src=brief:${oldAcked}`); // acked → skipped
    expect(bodies).not.toContain(`src=brief:${fresh}`); // not yet 24h → skipped
  });

  it("is idempotent — a second run doesn't double-escalate", async () => {
    await runBriefEscalation(new Date(), ownerDb);
    const dupes = await ownerDb
      .select({ id: briefs.id })
      .from(briefs)
      .where(like(briefs.body, `%src=brief:${oldUnacked}%`));
    expect(dupes.length).toBe(1);
  });
});

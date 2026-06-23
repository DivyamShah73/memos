import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  cleanupAndClose,
  enrollAgent,
  ownerDb,
  seedBase,
  seedLearning,
  seedProject,
  seedWorkflowRun,
} from "../_testutil.js";
import { agents, learnings } from "../db/schema.js";

const A = "project.vitest-lead";
let token: string;

beforeAll(async () => {
  await seedBase();
  await seedProject(A, false);
  token = await enrollAgent([A], "vitest-lead-hi");
  await enrollAgent([A], "vitest-lead-lo");
  // Give the two test agents distinct trust scores.
  await ownerDb.update(agents).set({ trustScore: "0.95" }).where(eq(agents.displayName, "vitest-lead-hi"));
  await ownerDb.update(agents).set({ trustScore: "0.30" }).where(eq(agents.displayName, "vitest-lead-lo"));
  // The hi agent authors a learning (counts toward learnings_authored).
  const [hi] = await ownerDb.select({ id: agents.id }).from(agents).where(eq(agents.displayName, "vitest-lead-hi"));
  const bd = await seedWorkflowRun(A);
  await ownerDb.insert(learnings).values({
    projectId: A,
    bdId: bd,
    agentId: hi.id,
    claim: "leaderboard learning",
    appliesTo: ["x"],
    confidence: "low",
  });
});

afterAll(async () => {
  await cleanupAndClose([A]);
});

describe("trust.leaderboard", () => {
  it("returns the team's agents sorted by trust score, with authored counts", async () => {
    const { status, json } = await call("trust.leaderboard", token, { project_id: A });
    expect(status).toBe(200);
    const board = json.data.leaderboard;
    expect(board.length).toBeGreaterThanOrEqual(2);
    // sorted desc by trust_score
    const scores = board.map((b: any) => b.trust_score);
    expect([...scores].sort((a: number, b: number) => b - a)).toEqual(scores);
    const hi = board.find((b: any) => b.display_name === "vitest-lead-hi");
    expect(hi.trust_score).toBeCloseTo(0.95, 5);
    expect(hi.learnings_authored).toBeGreaterThanOrEqual(1);
  });

  it("rejects an out-of-scope project (403)", async () => {
    const { status } = await call("trust.leaderboard", token, { project_id: "project.nope" });
    expect(status).toBe(403);
  });
});

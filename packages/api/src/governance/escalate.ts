/**
 * Brief-escalation sweep (Phase 6). An agent-targeted brief unacked by its target for >24h gets
 * escalated one level up — a new brief at the agent's team. Run on demand. Runs as the OWNER db
 * (sees all tenants). Idempotent via a stable marker `<!-- memos:escalation src=brief:… -->`.
 * `now` is injectable so tests don't depend on wall-clock.
 */
import { and, eq, lt, like } from "drizzle-orm";
import { db as ownerDb } from "../db/index.js";
import { agents, briefAcks, briefs } from "../db/schema.js";

type DB = typeof ownerDb;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface EscalationResult {
  escalated: number;
}

export async function runBriefEscalation(
  now: Date = new Date(),
  database: DB = ownerDb,
): Promise<EscalationResult> {
  const cutoff = new Date(now.getTime() - DAY_MS);

  const candidates = await database
    .select({ id: briefs.id, targetId: briefs.targetId, title: briefs.title })
    .from(briefs)
    .where(and(eq(briefs.targetKind, "agent"), lt(briefs.effectiveFrom, cutoff)));

  let escalated = 0;
  for (const b of candidates) {
    // Skip if a newer brief already supersedes this one.
    const superseded = await database
      .select({ id: briefs.id })
      .from(briefs)
      .where(eq(briefs.supersedesId, b.id))
      .limit(1);
    if (superseded.length > 0) continue;

    // Skip if the target agent has acked it.
    const acked = await database
      .select({ briefId: briefAcks.briefId })
      .from(briefAcks)
      .where(and(eq(briefAcks.briefId, b.id), eq(briefAcks.agentId, b.targetId)))
      .limit(1);
    if (acked.length > 0) continue;

    // Skip if already escalated.
    const marker = `<!-- memos:escalation src=brief:${b.id} -->`;
    const already = await database
      .select({ id: briefs.id })
      .from(briefs)
      .where(like(briefs.body, `%${marker}%`))
      .limit(1);
    if (already.length > 0) continue;

    // Escalate to the agent's team.
    const agentRow = await database
      .select({ teamId: agents.teamId })
      .from(agents)
      .where(eq(agents.id, b.targetId))
      .limit(1);
    const teamId = agentRow[0]?.teamId;
    if (!teamId) continue;

    await database.insert(briefs).values({
      title: `Escalation: unacked brief "${b.title}"`,
      body:
        `Agent ${b.targetId} has not acknowledged a brief for over 24h. Escalating to the team.\n\n${marker}`,
      targetKind: "team",
      targetId: teamId,
      authorId: "governance.escalation",
    });
    escalated++;
  }

  return { escalated };
}

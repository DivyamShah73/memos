/**
 * Brief-escalation sweep (Phase 6). An agent-targeted brief unacked by its target for >24h gets
 * escalated one level up — a new brief at the agent's team. Run on demand. Runs as the OWNER db
 * (sees all tenants). Idempotent via a stable marker `<!-- memos:escalation src=brief:… -->`.
 * `now` is injectable so tests don't depend on wall-clock.
 */
import { and, eq, isNotNull, isNull, lt } from "drizzle-orm";
import { db as ownerDb } from "../db/index.js";
import { agents, briefAcks, briefs } from "../db/schema.js";
import { insertBriefIdempotent, type DB } from "./_briefs.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface EscalationResult {
  escalated: number;
}

export async function runBriefEscalation(
  now: Date = new Date(),
  database: DB = ownerDb,
): Promise<EscalationResult> {
  const cutoff = new Date(now.getTime() - DAY_MS);

  // Fetch candidates in one query: agent-targeted briefs older than the cutoff that have not
  // been acked by their target and whose agent has a team to escalate to. The acked check is a
  // LEFT JOIN … IS NULL anti-join (no per-row round-trip); the teamId is fetched via a JOIN on
  // agents so no secondary lookup is needed either.
  const candidates = await database
    .select({
      id: briefs.id,
      targetId: briefs.targetId,
      title: briefs.title,
      teamId: agents.teamId,
    })
    .from(briefs)
    .leftJoin(agents, eq(agents.id, briefs.targetId))
    .leftJoin(briefAcks, and(eq(briefAcks.briefId, briefs.id), eq(briefAcks.agentId, briefs.targetId)))
    .where(
      and(
        eq(briefs.targetKind, "agent"),
        lt(briefs.effectiveFrom, cutoff),
        isNull(briefAcks.briefId),   // anti-join: not acked by target
        isNotNull(agents.teamId),    // only escalate when agent has a team
      ),
    );

  let escalated = 0;
  for (const b of candidates) {
    // teamId is guaranteed non-null by the isNotNull filter in the query above.

    // Skip if a newer brief already supersedes this one. This is a self-referential join on
    // a different column (supersedes_id = candidate.id) that cannot be expressed as a simple
    // equi-join in the initial query, so one query per candidate remains here.
    const superseded = await database
      .select({ id: briefs.id })
      .from(briefs)
      .where(eq(briefs.supersedesId, b.id))
      .limit(1);
    if (superseded.length > 0) continue;

    const marker = `<!-- memos:escalation src=brief:${b.id} -->`;
    const inserted = await insertBriefIdempotent(database, marker, {
      title: `Escalation: unacked brief "${b.title}"`,
      body: `Agent ${b.targetId} has not acknowledged a brief for over 24h. Escalating to the team.\n\n${marker}`,
      targetKind: "team",
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      targetId: b.teamId!, // non-null: isNotNull(agents.teamId) filtered nulls in the query
      authorId: "governance.escalation",
    });
    if (inserted) escalated++;
  }

  return { escalated };
}

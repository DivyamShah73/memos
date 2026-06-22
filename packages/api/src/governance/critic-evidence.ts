/**
 * Evidence-compliance critic (Phase 6). Scans every project's facts + learnings for the
 * invariant violation "confidence >= medium but no evidence_artifact_id" and files a brief at the
 * offending agent. The API gate prevents this on the write path; the critic catches rows that
 * bypassed it (seeded/imported/legacy). Runs as the OWNER db (superuser → sees all tenants,
 * bypasses RLS) — it's a fleet-wide governance sweep, not a tenant operation.
 *
 * Idempotent: each filed brief carries a stable marker `<!-- memos:critic:evidence src=… -->`;
 * a re-run skips violations already briefed.
 */
import { and, eq, isNull, ne } from "drizzle-orm";
import { db as ownerDb } from "../db/index.js";
import { facts, learnings } from "../db/schema.js";
import { insertBriefIdempotent, type DB } from "./_briefs.js";

export interface CriticResult {
  scanned: number;
  filed: number;
}

export async function runEvidenceCritic(database: DB = ownerDb): Promise<CriticResult> {
  const factViol = await database
    .select({ id: facts.id, agentId: facts.agentId, claim: facts.claim })
    .from(facts)
    .where(and(ne(facts.confidence, "low"), isNull(facts.evidenceArtifactId), eq(facts.status, "active")));
  const learnViol = await database
    .select({ id: learnings.id, agentId: learnings.agentId, claim: learnings.claim })
    .from(learnings)
    .where(
      and(ne(learnings.confidence, "low"), isNull(learnings.evidenceArtifactId), eq(learnings.status, "active")),
    );

  const violations = [
    ...factViol.map((v) => ({ kind: "fact" as const, ...v })),
    ...learnViol.map((v) => ({ kind: "learning" as const, ...v })),
  ];

  let filed = 0;
  for (const v of violations) {
    if (!v.agentId) continue; // can't target an unknown author
    const marker = `<!-- memos:critic:evidence src=${v.kind}:${v.id} -->`;
    const inserted = await insertBriefIdempotent(database, marker, {
      title: "Evidence gate: unbacked claim recorded",
      body:
        `A ${v.kind} was recorded at medium/high confidence with no evidence artifact:\n\n` +
        `> ${v.claim}\n\n` +
        `Attach an evidence_artifact_id, or downgrade the claim to low confidence.\n\n${marker}`,
      targetKind: "agent",
      targetId: v.agentId,
      authorId: "critic.evidence",
    });
    if (inserted) filed++;
  }

  return { scanned: violations.length, filed };
}

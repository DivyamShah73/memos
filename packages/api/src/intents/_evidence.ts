/**
 * Shared evidence-gate enforcement for fact.record + learning.record, so the two gates can't
 * drift. NOT a test (underscore prefix). Runs inside the caller's withScope transaction.
 */
import { and, eq } from "drizzle-orm";
import type { ScopedTx } from "../core/scope.js";
import { artifacts } from "../db/schema.js";

export interface EvidenceItem {
  confidence: "low" | "medium" | "high";
  evidence_artifact_id?: string;
  non_obvious_marker?: string;
}

export type EvidenceResult = { kind: "validation"; message: string } | { kind: "ok" };

/**
 * For each item: (1) re-assert the gate (confidence >= medium ⇒ evidence_artifact_id, and for
 * learnings a non_obvious_marker >= 15 chars) — defense in depth over the Zod schema; (2) if an
 * evidence_artifact_id is cited, verify it's a real artifact in THIS project and run via an
 * in-scope SELECT. Never trust the FK alone: it resolves a foreign-tenant id globally, so a
 * cross-tenant cite would bind silently or 500. The 0-rows path covers non-existent +
 * cross-tenant (RLS-invisible) + wrong-bd_id in one query.
 */
export async function assertEvidence(
  tx: ScopedTx,
  opts: { projectId: string; bdId: string; items: EvidenceItem[]; requireMarker?: boolean },
): Promise<EvidenceResult> {
  const { projectId, bdId, items, requireMarker } = opts;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.confidence !== "low") {
      if (!item.evidence_artifact_id) {
        return { kind: "validation", message: `item ${i}: evidence_artifact_id is required when confidence >= medium` };
      }
      if (requireMarker && (!item.non_obvious_marker || item.non_obvious_marker.length < 15)) {
        return { kind: "validation", message: `item ${i}: non_obvious_marker (>= 15 chars) is required when confidence >= medium` };
      }
    }
    if (item.evidence_artifact_id) {
      const rows = await tx
        .select({ id: artifacts.id })
        .from(artifacts)
        .where(
          and(
            eq(artifacts.id, item.evidence_artifact_id),
            eq(artifacts.projectId, projectId),
            eq(artifacts.bdId, bdId),
          ),
        )
        .limit(1);
      if (rows.length === 0) {
        return { kind: "validation", message: `item ${i}: evidence artifact not found in this run` };
      }
    }
  }
  return { kind: "ok" };
}

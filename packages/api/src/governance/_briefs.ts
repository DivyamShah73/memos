/**
 * Shared helpers for governance-worker brief filing (Phase 6).
 *
 * Both critics (evidence, escalation) use the same three-step pattern:
 *   1. Build a stable HTML-comment marker that uniquely identifies the violation.
 *   2. Check whether a brief with that marker already exists (idempotency).
 *   3. Insert the brief if not.
 *
 * Centralising this here means the pattern is maintained in one place and future
 * governance workers can call `insertBriefIdempotent` directly.
 */
import { like } from "drizzle-orm";
import { db as ownerDb } from "../db/index.js";
import { briefs } from "../db/schema.js";

export type DB = typeof ownerDb;

export interface BriefValues {
  title: string;
  body: string;
  targetKind: string;
  targetId: string;
  authorId: string;
}

/**
 * Insert a brief only if no existing brief already contains `marker` in its body.
 * Returns `true` if a new brief was inserted, `false` if it was skipped (idempotent).
 *
 * The `marker` must be a stable, unique string embedded verbatim in `values.body`
 * (convention: `<!-- memos:<worker>:<kind> src=<id> -->`).
 */
export async function insertBriefIdempotent(
  database: DB,
  marker: string,
  values: BriefValues,
): Promise<boolean> {
  const existing = await database
    .select({ id: briefs.id })
    .from(briefs)
    .where(like(briefs.body, `%${marker}%`))
    .limit(1);
  if (existing.length > 0) return false;

  await database.insert(briefs).values(values);
  return true;
}

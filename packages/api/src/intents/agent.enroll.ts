/**
 * agent.enroll — the only unauthenticated intent. Exchanges a single-use enrollment
 * code for a permanent bearer token (shown once). Single-use is enforced by an atomic
 * compare-and-swap, not the pre-check SELECT (which only buys a clearer error message).
 */
import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { EnrollInput } from "@memos/shared";
import type { IntentContext } from "../core/context.js";
import { ERROR_TYPE, fail, ok, type Envelope } from "../core/envelope.js";
import { generateToken, hashToken } from "../core/auth.js";
import { agents, enrollmentCodes } from "../db/schema.js";

/** Slug for the agent id: lowercase, [a-z0-9-] only, collapsed, capped (no prefix-spoof). */
function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "agent";
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === "23505";
}

export async function enroll(ctx: IntentContext, input: EnrollInput): Promise<Envelope> {
  const { code, display_name } = input;

  // Pre-check for message quality only. The real single-use guard is the CAS below.
  const existing = await ctx.db
    .select({ usedBy: enrollmentCodes.usedBy })
    .from(enrollmentCodes)
    .where(eq(enrollmentCodes.code, code))
    .limit(1);
  if (existing.length === 0) return fail("invalid enrollment code", ERROR_TYPE.badRequest);
  if (existing[0].usedBy !== null) {
    return fail("enrollment code already used", ERROR_TYPE.badRequest);
  }

  const raw = generateToken();
  const tokenHash = hashToken(raw);

  // Retry only guards the (astronomically unlikely) agent-id suffix collision; a rollback
  // frees the code claim so the retry re-claims cleanly with a fresh id.
  for (let attempt = 0; attempt < 3; attempt++) {
    const agentId = `agent.${slugify(display_name)}-${randomBytes(3).toString("hex")}`;
    try {
      const result = await ctx.db.transaction(async (tx) => {
        // Atomic claim: the WHERE used_by IS NULL is the compare-and-swap. The loser of a
        // race re-evaluates the predicate after the winner commits and matches 0 rows.
        const claimed = await tx
          .update(enrollmentCodes)
          .set({ usedBy: agentId, usedAt: sql`now()` })
          .where(and(eq(enrollmentCodes.code, code), isNull(enrollmentCodes.usedBy)))
          .returning({ teamId: enrollmentCodes.teamId, scopes: enrollmentCodes.scopes });

        if (claimed.length === 0) return { raced: true as const };

        const { teamId, scopes } = claimed[0];
        const scopeList = scopes ?? [];
        await tx.insert(agents).values({
          id: agentId,
          displayName: display_name,
          apiTokenHash: tokenHash,
          teamId,
          scopes: scopeList,
        });
        return { raced: false as const, scopes: scopeList };
      });

      if (result.raced) return fail("enrollment code already used", ERROR_TYPE.badRequest);
      return ok({ agent_id: agentId, api_token: { raw }, scopes: result.scopes });
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 2) continue; // id collision → new suffix
      throw err;
    }
  }
  // Unreachable in practice (3 distinct random suffixes); fail closed if it ever happens.
  return fail("could not allocate a unique agent id", ERROR_TYPE.platform);
}

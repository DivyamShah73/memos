/**
 * brief.create — author a standing instruction (brief) targeting an org/team/project/agent. The
 * author is the calling agent. Authoring is intentionally open (briefs_insert WITH CHECK(true),
 * ADR-006): a brief is outbound; read-isolation (who can SEE it) is the boundary, unchanged. An
 * optional supersedes_id must reference a brief visible to the author.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { BriefCreateInput } from "@memos/shared";
import type { IntentContext } from "../core/context.js";
import { ERROR_TYPE, fail, ok, type Envelope } from "../core/envelope.js";
import { isRlsViolation } from "../core/pgerrors.js";
import { briefs } from "../db/schema.js";

type TxResult = { kind: "validation"; message: string } | { kind: "created"; briefId: string };

export async function briefCreate(ctx: IntentContext, input: BriefCreateInput): Promise<Envelope> {
  const agent = ctx.agent;
  const withScope = ctx.withScope;
  if (!agent || !withScope) return fail("authentication required", ERROR_TYPE.unauthorized);

  const { target_kind, target_id, title, body, supersedes_id } = input;

  try {
    const result = await withScope(async (tx): Promise<TxResult> => {
      if (supersedes_id) {
        // Must be a brief the author can see (RLS) — can't supersede a brief you can't read.
        const prior = await tx.select({ id: briefs.id }).from(briefs).where(eq(briefs.id, supersedes_id)).limit(1);
        if (prior.length === 0) return { kind: "validation", message: "supersedes_id not found" };
      }
      // Generate the id here rather than INSERT ... RETURNING: under FORCE RLS, RETURNING
      // re-applies the briefs_select policy, which would hide a brief targeting someone other
      // than the author (the common case) and raise 42501 on an otherwise-valid insert.
      const briefId = randomUUID();
      await tx.insert(briefs).values({
        id: briefId,
        title,
        body,
        targetKind: target_kind,
        targetId: target_id,
        authorId: agent.id,
        supersedesId: supersedes_id ?? null,
      });
      return { kind: "created", briefId };
    });

    if (result.kind === "validation") return fail(result.message, ERROR_TYPE.badRequest);
    return ok({ brief_id: result.briefId });
  } catch (err) {
    if (isRlsViolation(err)) {
      return fail("brief insert rejected", ERROR_TYPE.forbidden);
    }
    throw err;
  }
}

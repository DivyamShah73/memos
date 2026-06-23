/**
 * brief.create — author a standing instruction (brief) targeting an org/team/project/agent. The
 * author is the calling agent. Authoring is intentionally open (briefs_insert WITH CHECK(true),
 * ADR-006): a brief is outbound; read-isolation (who can SEE it) is the boundary, unchanged.
 */
import { randomUUID } from "node:crypto";
import type { BriefCreateInput } from "@memos/shared";
import type { IntentContext } from "../core/context.js";
import { ERROR_TYPE, fail, ok, type Envelope } from "../core/envelope.js";
import { isRlsViolation } from "../core/pgerrors.js";
import { briefs } from "../db/schema.js";

export async function briefCreate(ctx: IntentContext, input: BriefCreateInput): Promise<Envelope> {
  const agent = ctx.agent;
  const withScope = ctx.withScope;
  if (!agent || !withScope) return fail("authentication required", ERROR_TYPE.unauthorized);

  const { target_kind, target_id, title, body } = input;

  try {
    // Generate the id rather than INSERT ... RETURNING: under FORCE RLS, RETURNING re-applies the
    // briefs_select policy, which hides a brief targeting someone other than the author (the
    // common case) and would raise 42501 on an otherwise-valid insert.
    const briefId = randomUUID();
    await withScope((tx) =>
      tx.insert(briefs).values({
        id: briefId,
        title,
        body,
        targetKind: target_kind,
        targetId: target_id,
        authorId: agent.id,
      }),
    );
    return ok({ brief_id: briefId });
  } catch (err) {
    if (isRlsViolation(err)) {
      return fail("brief insert rejected", ERROR_TYPE.forbidden);
    }
    throw err;
  }
}

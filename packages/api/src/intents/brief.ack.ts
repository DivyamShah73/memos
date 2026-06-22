/**
 * brief.ack — mark a brief acknowledged by the calling agent. The brief must be visible to the
 * agent (the identity RLS policy returns 0 rows otherwise → "brief not found"), so an agent can't
 * ack a brief targeted at someone else. The ack is idempotent (ON CONFLICT DO NOTHING).
 */
import { eq } from "drizzle-orm";
import type { BriefAckInput } from "@memos/shared";
import type { IntentContext } from "../core/context.js";
import { ERROR_TYPE, fail, ok, type Envelope } from "../core/envelope.js";
import { isRlsViolation } from "../core/pgerrors.js";
import { briefAcks, briefs } from "../db/schema.js";

type TxResult = { kind: "validation"; message: string } | { kind: "acked" };

export async function briefAck(ctx: IntentContext, input: BriefAckInput): Promise<Envelope> {
  const agent = ctx.agent;
  const withScope = ctx.withScope;
  if (!agent || !withScope) return fail("authentication required", ERROR_TYPE.unauthorized);

  const { brief_id } = input;

  try {
    const result = await withScope(async (tx): Promise<TxResult> => {
      const found = await tx
        .select({ id: briefs.id })
        .from(briefs)
        .where(eq(briefs.id, brief_id))
        .limit(1);
      if (found.length === 0) return { kind: "validation", message: "brief not found" };

      await tx
        .insert(briefAcks)
        .values({ briefId: brief_id, agentId: agent.id })
        .onConflictDoNothing();
      return { kind: "acked" };
    });

    if (result.kind === "validation") return fail(result.message, ERROR_TYPE.badRequest);
    return ok({ brief_id, acked: true });
  } catch (err) {
    if (isRlsViolation(err)) {
      return fail("brief not found", ERROR_TYPE.badRequest);
    }
    throw err;
  }
}

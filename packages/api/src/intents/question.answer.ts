/**
 * question.answer — answer an open question and deliver the answer to the asker as an
 * agent-targeted brief. The question must be in this project (RLS hides other tenants'); an
 * already-answered question is a clean business error. Filing the brief is allowed by the
 * briefs_insert WITH CHECK (true) policy — read-isolation, not write, is the briefs boundary.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { QuestionAnswerInput } from "@memos/shared";
import type { IntentContext } from "../core/context.js";
import { ERROR_TYPE, fail, ok, type Envelope } from "../core/envelope.js";
import { isRlsViolation } from "../core/pgerrors.js";
import { briefs, questions } from "../db/schema.js";

type TxResult =
  | { kind: "validation"; message: string }
  | { kind: "answered"; briefId: string };

export async function questionAnswer(
  ctx: IntentContext,
  input: QuestionAnswerInput,
): Promise<Envelope> {
  const agent = ctx.agent;
  const withScope = ctx.withScope;
  if (!agent || !withScope) return fail("authentication required", ERROR_TYPE.unauthorized);

  const { project_id, question_id, answer } = input;
  if (!agent.scopes.includes(project_id)) {
    return fail(`project ${project_id} is not in scope`, ERROR_TYPE.forbidden);
  }

  try {
    const result = await withScope(async (tx): Promise<TxResult> => {
      const found = await tx
        .select({
          status: questions.status,
          subject: questions.subject,
          askerId: questions.agentId,
        })
        .from(questions)
        .where(and(eq(questions.id, question_id), eq(questions.projectId, project_id)))
        .limit(1);
      if (found.length === 0) {
        return { kind: "validation", message: "question not found in this project" };
      }
      if (found[0].status === "answered") {
        return { kind: "validation", message: "question already answered" };
      }

      // Atomic flip: gate the UPDATE on status='open' and check it actually changed a row.
      // Two concurrent answerers both pass the SELECT above, but only the one whose UPDATE
      // wins the open→answered transition proceeds to file the brief — the loser updates 0
      // rows and bails, so no duplicate answer brief.
      const updated = await tx
        .update(questions)
        .set({ answer, status: "answered" })
        .where(
          and(
            eq(questions.id, question_id),
            eq(questions.projectId, project_id),
            eq(questions.status, "open"),
          ),
        )
        .returning({ id: questions.id });
      if (updated.length === 0) {
        return { kind: "validation", message: "question already answered" };
      }

      const subject = found[0].subject ?? "your question";
      // Generate the id rather than RETURNING: the answer brief targets the asker (often a
      // different agent), and under FORCE RLS, RETURNING would re-apply briefs_select and hide
      // that row from the answerer → a spurious 42501. (Same fix as brief.create.)
      const briefId = randomUUID();
      await tx.insert(briefs).values({
        id: briefId,
        title: `Re: ${subject}`,
        body: answer,
        targetKind: "agent",
        targetId: found[0].askerId ?? agent.id,
        authorId: agent.id,
      });
      return { kind: "answered", briefId };
    });

    if (result.kind === "validation") return fail(result.message, ERROR_TYPE.badRequest);
    return ok({ question_id, brief_id: result.briefId });
  } catch (err) {
    if (isRlsViolation(err)) {
      return fail(`project ${project_id} is not in scope`, ERROR_TYPE.forbidden);
    }
    throw err;
  }
}

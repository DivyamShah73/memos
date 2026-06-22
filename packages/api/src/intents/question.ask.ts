/**
 * question.ask — an agent asks the operator a question, scoped to a project and optionally
 * threaded onto an open workflow run. The answer is delivered later as a brief (question.answer).
 */
import type { QuestionAskInput } from "@memos/shared";
import type { IntentContext } from "../core/context.js";
import { ERROR_TYPE, fail, ok, type Envelope } from "../core/envelope.js";
import { isRlsViolation } from "../core/pgerrors.js";
import { assertRunWritable } from "./_evidence.js";
import { questions } from "../db/schema.js";

type TxResult =
  | { kind: "validation"; message: string }
  | { kind: "created"; questionId: string };

export async function questionAsk(ctx: IntentContext, input: QuestionAskInput): Promise<Envelope> {
  const agent = ctx.agent;
  const withScope = ctx.withScope;
  if (!agent || !withScope) return fail("authentication required", ERROR_TYPE.unauthorized);

  const { project_id, bd_id, subject, body, urgency } = input;
  if (!agent.scopes.includes(project_id)) {
    return fail(`project ${project_id} is not in scope`, ERROR_TYPE.forbidden);
  }

  try {
    const result = await withScope(async (tx): Promise<TxResult> => {
      if (bd_id) {
        const run = await assertRunWritable(tx, project_id, bd_id);
        if (!run.ok) return { kind: "validation", message: run.message };
      }
      const [row] = await tx
        .insert(questions)
        .values({
          projectId: project_id,
          bdId: bd_id ?? null,
          agentId: agent.id,
          subject: subject ?? null,
          body,
          urgency: urgency ?? null,
          status: "open",
        })
        .returning({ id: questions.id });
      return { kind: "created", questionId: row.id };
    });

    if (result.kind === "validation") return fail(result.message, ERROR_TYPE.badRequest);
    return ok({ question_id: result.questionId });
  } catch (err) {
    if (isRlsViolation(err)) {
      return fail(`project ${project_id} is not in scope`, ERROR_TYPE.forbidden);
    }
    throw err;
  }
}

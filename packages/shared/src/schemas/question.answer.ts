import { z } from "zod";

/**
 * Input for `question.answer` — answer an open question; the answer is delivered to the asker
 * as an agent-targeted brief.
 */
export const questionAnswerInputSchema = z.object({
  project_id: z.string().min(1, "is required"),
  question_id: z.string().uuid(),
  answer: z.string().min(1, "is required"),
});

export type QuestionAnswerInput = z.infer<typeof questionAnswerInputSchema>;

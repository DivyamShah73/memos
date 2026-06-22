import { z } from "zod";

/**
 * Input for `question.ask` — an agent asks the operator a question, scoped to a project and
 * optionally threaded onto a workflow run. The answer comes back later as a brief.
 */
export const questionAskInputSchema = z.object({
  project_id: z.string().min(1, "is required"),
  bd_id: z.string().min(1).optional(),
  subject: z.string().min(1).optional(),
  body: z.string().min(1, "is required"),
  urgency: z.enum(["low", "medium", "high"]).optional(),
});

export type QuestionAskInput = z.infer<typeof questionAskInputSchema>;

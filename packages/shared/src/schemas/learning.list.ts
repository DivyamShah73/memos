import { z } from "zod";

/**
 * Input for `learning.list` — browse a project's learnings ranked by reuse (the picker for the
 * provenance view). Unlike `learning.query`, no keyword: it lists the most-reused learnings.
 */
export const learningListInputSchema = z.object({
  project_id: z.string().min(1, "is required"),
  limit: z.number().int().positive().max(50).optional().default(30),
});

export type LearningListInput = z.infer<typeof learningListInputSchema>;

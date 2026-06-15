import { z } from "zod";

/**
 * Input for `learning.query` — keyword full-text search over learnings in one project, with
 * an optional problem-domain tag filter. (Cross-silo tag-only discovery is a Phase 6 path.)
 */
export const learningQueryInputSchema = z.object({
  project_id: z.string().min(1, "is required"),
  query: z.string().min(1, "is required"),
  applies_to: z.array(z.string().min(1)).optional(),
  limit: z.number().int().positive().max(50).optional().default(20),
});

export type LearningQueryInput = z.infer<typeof learningQueryInputSchema>;

import { z } from "zod";

/**
 * Input for `learning.query` — keyword full-text search over learnings in one project, with
 * an optional problem-domain tag filter. (Cross-silo tag-only discovery is a Phase 6 path.)
 */
export const learningQueryInputSchema = z.object({
  project_id: z.string().min(1, "is required"),
  // .trim() first: a whitespace-only query → empty tsquery, which `@@` treats as matching
  // every row — i.e. it would dump the whole project. Reject it as a missing keyword.
  query: z.string().trim().min(1, "is required"),
  applies_to: z.array(z.string().min(1)).min(1).optional(),
  limit: z.number().int().positive().max(50).optional().default(20),
});

export type LearningQueryInput = z.infer<typeof learningQueryInputSchema>;

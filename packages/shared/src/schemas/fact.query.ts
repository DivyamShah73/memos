import { z } from "zod";

/** Input for `fact.query` — keyword full-text search over facts in one project. */
export const factQueryInputSchema = z.object({
  project_id: z.string().min(1, "is required"),
  // .trim() first: a whitespace-only query → empty tsquery, which `@@` treats as matching
  // every row — i.e. it would dump the whole project. Reject it as a missing keyword.
  query: z.string().trim().min(1, "is required"),
  limit: z.number().int().positive().max(50).optional().default(20),
});

export type FactQueryInput = z.infer<typeof factQueryInputSchema>;

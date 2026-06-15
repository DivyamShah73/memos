import { z } from "zod";

/** Input for `fact.query` — keyword full-text search over facts in one project. */
export const factQueryInputSchema = z.object({
  project_id: z.string().min(1, "is required"),
  query: z.string().min(1, "is required"),
  limit: z.number().int().positive().max(50).optional().default(20),
});

export type FactQueryInput = z.infer<typeof factQueryInputSchema>;

import { z } from "zod";

/**
 * Input for `objective.query` — read a project's OKR tree with rolled-up progress. With
 * objective_id, returns that objective's subtree; without, all root objectives in the project.
 */
export const objectiveQueryInputSchema = z.object({
  project_id: z.string().min(1, "is required"),
  objective_id: z.string().uuid().optional(),
  include_children: z.boolean().optional().default(true),
});

export type ObjectiveQueryInput = z.infer<typeof objectiveQueryInputSchema>;

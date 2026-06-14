import { z } from "zod";

/**
 * Input for `workflow.create` — opens a unit of agent work (→ bd_id). On projects with
 * okrs_required=true, `target_objective_id` is mandatory and must reference a non-abandoned
 * objective in the project (enforced in the handler, not the schema).
 */
export const workflowCreateInputSchema = z.object({
  project_id: z.string().min(1, "is required"),
  workflow_class: z.string().min(1, "is required"),
  title: z.string().min(1, "is required"),
  target_objective_id: z.string().uuid().optional(),
});

export type WorkflowCreateInput = z.infer<typeof workflowCreateInputSchema>;

import { z } from "zod";

/**
 * Input for `objective.update` — patch a mutable field on an objective (title, description,
 * target, weight) or transition its status. At least one mutable field must be present.
 */
export const objectiveUpdateInputSchema = z
  .object({
    project_id: z.string().min(1, "is required"),
    objective_id: z.string().uuid(),
    bd_id: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    target_completion: z.string().datetime().optional(),
    weight: z.number().positive().optional(),
    status: z.enum(["active", "achieved", "abandoned", "superseded"]).optional(),
  })
  .refine(
    (v) =>
      v.title !== undefined ||
      v.description !== undefined ||
      v.target_completion !== undefined ||
      v.weight !== undefined ||
      v.status !== undefined,
    { message: "at least one field to update is required", path: ["status"] },
  );

export type ObjectiveUpdateInput = z.infer<typeof objectiveUpdateInputSchema>;

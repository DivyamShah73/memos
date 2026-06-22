import { z } from "zod";

/** One inline key-result/milestone created with the objective. A metric_target makes it a KR. */
export const objectiveMilestoneSchema = z.object({
  title: z.string().min(1, "is required"),
  description: z.string().optional(),
  position: z.number().int().optional(),
  metric_target: z.number().optional(),
  metric_current: z.number().optional(),
  metric_unit: z.string().optional(),
  metric_direction: z.enum(["up", "down"]).optional(),
});

/**
 * Input for `objective.publish` — create an objective (optionally a sub-OKR via parent_id +
 * weight) with optional inline milestones/KRs. bd_id is the provenance run that created it.
 */
export const objectivePublishInputSchema = z.object({
  project_id: z.string().min(1, "is required"),
  bd_id: z.string().min(1, "is required"),
  title: z.string().min(1, "is required"),
  description: z.string().optional(),
  target_completion: z.string().datetime().optional(),
  parent_id: z.string().uuid().optional(),
  weight: z.number().positive().optional(),
  milestones: z.array(objectiveMilestoneSchema).max(50, "at most 50 milestones").optional(),
});

export type ObjectivePublishInput = z.infer<typeof objectivePublishInputSchema>;

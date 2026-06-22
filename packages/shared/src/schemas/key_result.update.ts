import { z } from "zod";

/**
 * Input for `key_result.update` — move a key result's current metric value and read back the
 * recomputed progress. The target milestone must have a metric_target (i.e. be a KR, not a plain
 * milestone). Updating the metric does NOT achieve it — achievement is explicit + evidence-gated.
 */
export const keyResultUpdateInputSchema = z.object({
  project_id: z.string().min(1, "is required"),
  milestone_id: z.string().uuid(),
  metric_current: z.number(),
  bd_id: z.string().min(1).optional(),
});

export type KeyResultUpdateInput = z.infer<typeof keyResultUpdateInputSchema>;

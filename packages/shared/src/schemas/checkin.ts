import { z } from "zod";

/**
 * Input for `checkin` — records a state change on a workflow run. `complete`/`failed` close
 * the run. On okrs_required projects the checkin must repeat the run's `target_objective_id`
 * (enforced in the handler).
 */
export const checkinInputSchema = z.object({
  project_id: z.string().min(1, "is required"),
  bd_id: z.string().min(1, "is required"),
  status: z.enum(["start", "progress", "blocked", "complete", "failed"]),
  current_task: z.string().optional(),
  target_objective_id: z.string().uuid().optional(),
});

export type CheckinInput = z.infer<typeof checkinInputSchema>;

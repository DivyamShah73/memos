import { z } from "zod";

/**
 * Input for `activity.recent` — the initial page of the dashboard's live feed: the most recent
 * checkins, facts, and learnings in one project (the SSE stream then appends new ones live).
 */
export const activityRecentInputSchema = z.object({
  project_id: z.string().min(1, "is required"),
  limit: z.number().int().positive().max(50).optional().default(30),
});

export type ActivityRecentInput = z.infer<typeof activityRecentInputSchema>;

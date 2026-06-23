import { z } from "zod";

/**
 * Input for `trust.leaderboard` — agents on the caller's team ranked by trust score (with how
 * many learnings each has authored in this project). project_id scopes the caller.
 */
export const trustLeaderboardInputSchema = z.object({
  project_id: z.string().min(1, "is required"),
});

export type TrustLeaderboardInput = z.infer<typeof trustLeaderboardInputSchema>;

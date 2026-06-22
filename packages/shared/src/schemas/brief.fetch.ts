import { z } from "zod";

/**
 * Input for `brief.fetch` — return the standing briefs targeting this agent (its agent id, team,
 * org, or this project) plus the project's active OKRs. Superseded and (by default) acked briefs
 * are excluded.
 */
export const briefFetchInputSchema = z.object({
  project_id: z.string().min(1, "is required"),
  include_acked: z.boolean().optional().default(false),
});

export type BriefFetchInput = z.infer<typeof briefFetchInputSchema>;

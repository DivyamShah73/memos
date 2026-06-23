import { z } from "zod";

/**
 * Input for `brief.create` — an operator authors a standing instruction (brief) targeting an
 * org/team/project/agent. Authoring is open (briefs are outbound; read-isolation is the boundary,
 * ADR-006); the author is the calling agent.
 */
export const briefCreateInputSchema = z.object({
  target_kind: z.enum(["org", "team", "project", "agent"]),
  target_id: z.string().min(1, "is required"),
  title: z.string().min(1, "is required"),
  body: z.string().min(1, "is required"),
  supersedes_id: z.string().uuid().optional(),
});

export type BriefCreateInput = z.infer<typeof briefCreateInputSchema>;

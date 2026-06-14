import { z } from "zod";

/**
 * Input schema for the `agent.enroll` intent (the one unauthenticated intent).
 * An agent exchanges a single-use enrollment code for a permanent bearer token.
 */
export const enrollInputSchema = z.object({
  code: z.string().min(1, "is required"),
  display_name: z.string().min(1, "is required"),
});

export type EnrollInput = z.infer<typeof enrollInputSchema>;

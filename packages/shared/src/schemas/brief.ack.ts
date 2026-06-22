import { z } from "zod";

/** Input for `brief.ack` — mark a brief as acknowledged by the calling agent. */
export const briefAckInputSchema = z.object({
  brief_id: z.string().uuid(),
});

export type BriefAckInput = z.infer<typeof briefAckInputSchema>;

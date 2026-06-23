import { z } from "zod";

/**
 * Input for the `user.login` intent (public, Phase 13). A human exchanges email + password for a
 * dashboard-session bearer token (the gateway then authenticates that token as a user principal).
 */
export const userLoginInputSchema = z.object({
  email: z.string().min(1, "is required"),
  password: z.string().min(1, "is required"),
});

export type UserLoginInput = z.infer<typeof userLoginInputSchema>;

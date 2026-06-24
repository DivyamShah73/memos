import { z } from "zod";

/** Self-serve admin intents (Phase 14). org.signup is public; the rest require manager/ceo. */

const role = z.enum(["member", "manager", "ceo"]);

/** Create a brand-new org with its first CEO (public — the product's front door). */
export const orgSignupInputSchema = z.object({
  org_name: z.string().min(1, "is required"),
  email: z.string().min(1, "is required"),
  password: z.string().min(8, "must be at least 8 characters"),
  display_name: z.string().min(1).optional(),
});
export type OrgSignupInput = z.infer<typeof orgSignupInputSchema>;

/** A manager/CEO mints a single-use agent enrollment code for a project in their scope. */
export const enrollmentCreateInputSchema = z.object({
  project_id: z.string().min(1, "is required"),
  role: role.default("member"),
});
export type EnrollmentCreateInput = z.infer<typeof enrollmentCreateInputSchema>;

/** A manager/CEO invites a person (creates a user + one membership) into their org. */
export const userInviteInputSchema = z.object({
  email: z.string().min(1, "is required"),
  password: z.string().min(8, "must be at least 8 characters"),
  display_name: z.string().min(1, "is required"),
  role,
  scope_kind: z.enum(["org", "team", "project"]),
  scope_id: z.string().min(1, "is required"),
});
export type UserInviteInput = z.infer<typeof userInviteInputSchema>;

/** A manager/CEO revokes an agent (token stops working immediately). */
export const agentRevokeInputSchema = z.object({
  agent_id: z.string().min(1, "is required"),
});
export type AgentRevokeInput = z.infer<typeof agentRevokeInputSchema>;

/** A manager/CEO offboards a user (disables login + kills their dashboard session). */
export const memberOffboardInputSchema = z.object({
  user_id: z.string().min(1, "is required"),
});
export type MemberOffboardInput = z.infer<typeof memberOffboardInputSchema>;

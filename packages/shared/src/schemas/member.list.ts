import { z } from "zod";

/**
 * Input for `member.list` (Phase 15, manager/CEO) — none. Lists the human members of the caller's
 * org (users + their memberships); org isolation is enforced at the DB via the `memos.org_id` GUC.
 */
export const memberListInputSchema = z.object({});

export type MemberListInput = z.infer<typeof memberListInputSchema>;

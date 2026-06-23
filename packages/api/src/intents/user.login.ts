/**
 * user.login — public (Phase 13). A human exchanges email + password for a dashboard-session bearer
 * token. The gateway then authenticates that token as a USER principal (role + project scope from
 * memberships). The dashboard stores the token in its signed, httpOnly session cookie.
 */
import type { UserLoginInput } from "@memos/shared";
import type { IntentContext } from "../core/context.js";
import { ERROR_TYPE, fail, ok, type Envelope } from "../core/envelope.js";
import { loginUser, resolveUserScope, startUserSession } from "../core/users.js";

export async function userLogin(_ctx: IntentContext, input: UserLoginInput): Promise<Envelope> {
  const u = await loginUser(input.email, input.password);
  if (!u) return fail("invalid email or password", ERROR_TYPE.unauthorized);

  const raw = await startUserSession(u.userId);
  const scope = await resolveUserScope(u.orgId, u.userId);
  const role = scope.roles.includes("ceo")
    ? "ceo"
    : scope.roles.includes("manager")
      ? "manager"
      : "member";

  return ok({
    api_token: { raw },
    user_id: u.userId,
    org_id: u.orgId,
    display_name: u.displayName,
    role,
    projects: scope.projects,
  });
}

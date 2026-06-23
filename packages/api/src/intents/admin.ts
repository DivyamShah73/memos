/**
 * Self-serve admin & lifecycle intents (Phase 14 / ADR-012). org.signup is public; the rest are
 * org-administration (manager/CEO via the authz matrix). Each cross-checks that the target belongs to
 * the actor's org (no cross-org administration) and records an audit entry. Control-plane writes use
 * the owner connection (these tables aren't project-RLS'd; org ownership is verified in-handler).
 */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type {
  AgentRevokeInput,
  EnrollmentCreateInput,
  MemberOffboardInput,
  OrgSignupInput,
  UserInviteInput,
} from "@memos/shared";
import type { IntentContext } from "../core/context.js";
import type { AuthedAgent } from "../core/auth.js";
import { ERROR_TYPE, fail, ok, type Envelope } from "../core/envelope.js";
import { db as ownerDb } from "../db/index.js";
import { agents, enrollmentCodes, projects, teams, users } from "../db/schema.js";
import {
  provisionOrg,
  provisionUser,
  recordAudit,
  resolveUserScope,
  startUserSession,
} from "../core/users.js";

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "org";
const rid = () => randomBytes(3).toString("hex");

/** Role rank for the no-escalation check — you can only grant a role ≤ your own. */
const RANK: Record<string, number> = { member: 1, manager: 2, ceo: 3 };
const rank = (r: string) => RANK[r] ?? 1;

/** Public: create a brand-new org + its first CEO, and return a ready session token. */
export async function orgSignup(_ctx: IntentContext, input: OrgSignupInput): Promise<Envelope> {
  const base = slug(input.org_name);
  const orgId = `org.${base}-${rid()}`;
  const teamId = `team.${base}-${rid()}`;
  const projectId = `project.${base}-${rid()}`;
  const { userId } = await provisionOrg({
    orgId, orgName: input.org_name, teamId, teamName: input.org_name,
    projectId, projectName: `${input.org_name} project`,
    ceoEmail: input.email, ceoPassword: input.password, ceoName: input.display_name ?? "CEO",
  });
  const token = await startUserSession(userId);
  const scope = await resolveUserScope(orgId, userId);
  await recordAudit(orgId, userId, "org.signup", orgId, { email: input.email });
  return ok({ org_id: orgId, user_id: userId, api_token: { raw: token }, role: "ceo", projects: scope.projects });
}

/** The authed principal with a guaranteed non-null orgId (admin intents always run org-scoped). */
function principal(ctx: IntentContext): (AuthedAgent & { orgId: string }) | null {
  const a = ctx.agent;
  if (!a || !a.orgId) return null;
  return a as AuthedAgent & { orgId: string };
}

/** manager/CEO: mint a single-use agent enrollment code for a project in the actor's scope. */
export async function enrollmentCreate(ctx: IntentContext, input: EnrollmentCreateInput): Promise<Envelope> {
  const a = principal(ctx);
  if (!a) return fail("authentication required", ERROR_TYPE.unauthorized);
  if (!a.scopes.includes(input.project_id)) {
    return fail(`project ${input.project_id} is not in your scope`, ERROR_TYPE.forbidden);
  }
  // No escalation: you can't mint a code for a role higher than your own (review H1/L1).
  if (rank(input.role) > rank(a.role)) {
    return fail("cannot grant a role higher than your own", ERROR_TYPE.forbidden);
  }
  const [proj] = await ownerDb
    .select({ teamId: projects.teamId, orgId: projects.orgId })
    .from(projects).where(eq(projects.id, input.project_id)).limit(1);
  if (!proj || proj.orgId !== a.orgId) return fail("unknown project", ERROR_TYPE.badRequest);

  const code = `enr_${slug(input.project_id)}_${randomBytes(8).toString("hex")}`;
  await ownerDb.insert(enrollmentCodes).values({
    code, teamId: proj.teamId, orgId: a.orgId, role: input.role, scopes: [input.project_id],
  });
  await recordAudit(a.orgId, a.id, "enrollment.create", input.project_id, { role: input.role });
  return ok({ code, role: input.role, project_id: input.project_id });
}

/** manager/CEO: invite a person into the actor's org (a project invite must be in the actor's scope). */
export async function userInvite(ctx: IntentContext, input: UserInviteInput): Promise<Envelope> {
  const a = principal(ctx);
  if (!a) return fail("authentication required", ERROR_TYPE.unauthorized);
  // No escalation: can't invite someone with a role higher than your own (review H1).
  if (rank(input.role) > rank(a.role)) {
    return fail("cannot grant a role higher than your own", ERROR_TYPE.forbidden);
  }
  // Bound the membership scope to the actor's org for EVERY scope kind (review H2): a project must
  // be in the actor's scope; a team must belong to the actor's org; an org scope must be the actor's.
  if (input.scope_kind === "project") {
    if (!a.scopes.includes(input.scope_id)) {
      return fail(`project ${input.scope_id} is not in your scope`, ERROR_TYPE.forbidden);
    }
  } else if (input.scope_kind === "team") {
    const [tm] = await ownerDb.select({ orgId: teams.orgId }).from(teams).where(eq(teams.id, input.scope_id)).limit(1);
    if (!tm || tm.orgId !== a.orgId) return fail(`team ${input.scope_id} is not in your org`, ERROR_TYPE.forbidden);
  } else {
    if (input.scope_id !== a.orgId) return fail(`org ${input.scope_id} is not your org`, ERROR_TYPE.forbidden);
  }
  const { userId } = await provisionUser({
    orgId: a.orgId, email: input.email, password: input.password,
    displayName: input.display_name, role: input.role, scopeKind: input.scope_kind, scopeId: input.scope_id,
  });
  await recordAudit(a.orgId, a.id, "user.invite", userId, { email: input.email, role: input.role });
  return ok({ user_id: userId });
}

/** manager/CEO: revoke an agent in the actor's org (its token stops resolving immediately). */
export async function agentRevoke(ctx: IntentContext, input: AgentRevokeInput): Promise<Envelope> {
  const a = principal(ctx);
  if (!a) return fail("authentication required", ERROR_TYPE.unauthorized);
  const [target] = await ownerDb.select({ orgId: agents.orgId }).from(agents).where(eq(agents.id, input.agent_id)).limit(1);
  if (!target || target.orgId !== a.orgId) return fail("unknown agent", ERROR_TYPE.badRequest);
  await ownerDb.update(agents).set({ status: "revoked" }).where(eq(agents.id, input.agent_id));
  await recordAudit(a.orgId, a.id, "agent.revoke", input.agent_id);
  return ok({ agent_id: input.agent_id, status: "revoked" });
}

/** manager/CEO: offboard a user in the actor's org — disable login + kill their dashboard session. */
export async function memberOffboard(ctx: IntentContext, input: MemberOffboardInput): Promise<Envelope> {
  const a = principal(ctx);
  if (!a) return fail("authentication required", ERROR_TYPE.unauthorized);
  const [target] = await ownerDb.select({ orgId: users.orgId }).from(users).where(eq(users.id, input.user_id)).limit(1);
  if (!target || target.orgId !== a.orgId) return fail("unknown user", ERROR_TYPE.badRequest);
  await ownerDb.update(users).set({ status: "disabled", sessionTokenHash: null }).where(eq(users.id, input.user_id));
  await recordAudit(a.orgId, a.id, "member.offboard", input.user_id);
  return ok({ user_id: input.user_id, status: "disabled" });
}

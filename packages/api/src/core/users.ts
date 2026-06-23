/**
 * Human identity (Phase 11 / ADR-009). People are distinct from agents: they authenticate with a
 * password (a low-entropy secret → scrypt KDF, NOT the SHA-256 used for 256-bit agent tokens), and
 * their read scope is resolved from `memberships`.
 *
 * These are AUTH-BOOTSTRAP operations: they must find the user (and thus the org) BEFORE an org GUC
 * can be set, so they run on the OWNER connection (`db/index.ts`) which bypasses RLS. Everything a
 * handler does AFTER login goes through the scoped `memos_app` connection with the org+project GUCs.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db as ownerDb } from "../db/index.js";
import { memberships, orgs, projects, teams, users } from "../db/schema.js";

// scrypt params: N=16384 (2^14) is a sensible interactive cost; login is rare so the sync call is fine.
const SCRYPT = { N: 16384, r: 8, p: 1 } as const;
const KEYLEN = 64;

/** `scrypt$<salt hex>$<hash hex>` — self-describing so verification needs no out-of-band params. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, SCRYPT);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** Constant-time verify against a `hashPassword` string. False on any malformed/legacy value. */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const actual = scryptSync(password, salt, expected.length, SCRYPT);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export interface LoggedInUser {
  userId: string;
  orgId: string;
  displayName: string;
}

/**
 * Verify an email+password and return the user's identity (incl. org). Owner connection: the lookup
 * is by a unique credential (email) and must run before the org is known. Returns null on unknown
 * email, disabled account, or wrong password (no enumeration of which).
 */
export async function loginUser(email: string, password: string): Promise<LoggedInUser | null> {
  const rows = await ownerDb
    .select({
      id: users.id,
      orgId: users.orgId,
      displayName: users.displayName,
      passwordHash: users.passwordHash,
      status: users.status,
    })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);
  const u = rows[0];
  if (!u || u.status !== "active") return null;
  if (!verifyPassword(password, u.passwordHash)) return null;
  return { userId: u.id, orgId: u.orgId, displayName: u.displayName };
}

export interface UserScope {
  orgId: string;
  roles: string[];
  /** The project ids this user can read — fed into the same `memos.agent_projects` GUC as agents. */
  projects: string[];
}

/**
 * Resolve a user's read scope from `memberships`: CEO (org) → every project in the org; manager
 * (team) → that team's projects; member (project) → that project. The union becomes the user's
 * project scope. (Role *capability* enforcement is Phase 12; this only resolves read reach.)
 */
export async function resolveUserScope(orgId: string, userId: string): Promise<UserScope> {
  // Scope to (userId AND orgId): the owner connection bypasses RLS, so this must self-scope by org
  // — never widen a user's reach with another org's memberships (defense-in-depth).
  const mems = await ownerDb
    .select({ scopeKind: memberships.scopeKind, scopeId: memberships.scopeId, role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)));

  const projectSet = new Set<string>();
  const roles: string[] = [];
  for (const m of mems) {
    roles.push(m.role);
    if (m.role === "ceo" && m.scopeKind === "org") {
      const ps = await ownerDb.select({ id: projects.id }).from(projects).where(eq(projects.orgId, orgId));
      for (const p of ps) projectSet.add(p.id);
    } else if (m.scopeKind === "team") {
      const ps = await ownerDb.select({ id: projects.id }).from(projects).where(eq(projects.teamId, m.scopeId));
      for (const p of ps) projectSet.add(p.id);
    } else if (m.scopeKind === "project") {
      projectSet.add(m.scopeId);
    }
  }
  return { orgId, roles, projects: [...projectSet] };
}

export interface ProvisionOrgOpts {
  orgId: string;
  orgName: string;
  teamId: string;
  teamName?: string;
  projectId: string;
  projectName?: string;
  ceoEmail: string;
  ceoPassword: string;
  ceoName?: string;
}

/**
 * Create an org with a starter team/project and a CEO user (org-level `ceo` membership). Idempotent
 * (fixed ids + onConflictDoNothing; user matched by email). Used by seed/tests now; the self-serve
 * signup intent is Phase 14. Owner connection (bypasses RLS to seed the org-walled people tables).
 */
export async function provisionOrg(opts: ProvisionOrgOpts): Promise<{ userId: string }> {
  await ownerDb.insert(orgs).values({ id: opts.orgId, name: opts.orgName }).onConflictDoNothing();
  await ownerDb
    .insert(teams)
    .values({ id: opts.teamId, orgId: opts.orgId, name: opts.teamName ?? opts.teamId })
    .onConflictDoNothing();
  await ownerDb
    .insert(projects)
    .values({ id: opts.projectId, teamId: opts.teamId, orgId: opts.orgId, name: opts.projectName ?? opts.projectId })
    .onConflictDoNothing();

  // Email check scoped to THIS org (owner connection bypasses RLS): a same email in another org
  // must not silently return that org's user. (Per-org email + login disambiguation is Phase 13/14.)
  const existing = await ownerDb
    .select({ id: users.id })
    .from(users)
    .where(and(sql`lower(${users.email}) = lower(${opts.ceoEmail})`, eq(users.orgId, opts.orgId)))
    .limit(1);
  if (existing[0]) return { userId: existing[0].id };

  const [u] = await ownerDb
    .insert(users)
    .values({
      orgId: opts.orgId,
      email: opts.ceoEmail,
      passwordHash: hashPassword(opts.ceoPassword),
      displayName: opts.ceoName ?? "CEO",
    })
    .returning({ id: users.id });
  await ownerDb
    .insert(memberships)
    .values({ orgId: opts.orgId, userId: u.id, scopeKind: "org", scopeId: opts.orgId, role: "ceo" })
    .onConflictDoNothing();
  return { userId: u.id };
}

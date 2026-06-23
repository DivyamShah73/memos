/**
 * Bearer-token auth. Tokens are high-entropy random strings (256 bits), so they're
 * stored as a fast SHA-256 hash and looked up by hash — bcrypt/argon2 are for
 * low-entropy passwords and would only add per-request latency (ADR-003). The raw
 * `syn_…` token is shown to the agent exactly once at enrollment.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { agents } from "../db/schema.js";
import type { GatewayDb } from "../db/gateway.js";

export interface AuthedAgent {
  id: string;
  teamId: string | null;
  /** Org owning the agent (denormalized onto agents in Phase 11/ADR-009). Drives the org GUC. */
  orgId: string | null;
  /** Authorization role (Phase 12/ADR-010): member | manager | ceo. Drives the dispatch authz guard. */
  role: string;
  scopes: string[];
  trustScore: string;
}

/** Generate a fresh opaque bearer token. Shown once; only its hash is stored. */
export function generateToken(): string {
  return "syn_" + randomBytes(32).toString("base64url");
}

/** Lowercase hex SHA-256 of the raw token. Encoding must match at enroll + auth time. */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Pull the token out of an `Authorization: Bearer <token>` header. */
export function extractBearer(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return m ? m[1].trim() : null;
}

/**
 * Resolve a raw bearer token to its agent. The `status = 'active'` filter is in SQL so a
 * revoked agent's row never even returns — revocation takes effect immediately.
 */
export async function resolveAgent(
  db: GatewayDb,
  raw: string,
): Promise<AuthedAgent | null> {
  const hash = hashToken(raw);
  // org_id is read straight off the agents row (denormalized) — no teams join. This is what lets
  // teams/control-plane tables be org-RLS'd without deadlocking auth (ADR-009): the lookup is a
  // single by-token-hash read on a table that is NOT org-RLS'd.
  const rows = await db
    .select({
      id: agents.id,
      teamId: agents.teamId,
      orgId: agents.orgId,
      role: agents.role,
      scopes: agents.scopes,
      trustScore: agents.trustScore,
    })
    .from(agents)
    .where(and(eq(agents.apiTokenHash, hash), eq(agents.status, "active")))
    .limit(1);
  const a = rows[0];
  if (!a) return null;
  return {
    id: a.id,
    teamId: a.teamId,
    orgId: a.orgId ?? null,
    role: a.role ?? "member",
    scopes: a.scopes ?? [],
    trustScore: a.trustScore,
  };
}

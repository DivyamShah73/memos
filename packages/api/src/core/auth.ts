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
  const rows = await db
    .select({
      id: agents.id,
      teamId: agents.teamId,
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
    scopes: a.scopes ?? [],
    trustScore: a.trustScore,
  };
}

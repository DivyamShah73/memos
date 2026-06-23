/**
 * Signed-cookie session for the dashboard (Phase 13 / ADR-011). The cookie carries the user's
 * gateway session token (minted by the `user.login` intent), HMAC-signed so it can't be forged and
 * httpOnly so JS can't read it. The server reads the token back out to call the gateway AS that user
 * — so the dashboard is scoped by the logged-in person's role + projects, not a shared operator.
 * Uses node:crypto → Node runtime only (server components / actions / route handlers); the edge
 * middleware does a cheap presence check via SESSION_COOKIE.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export { SESSION_COOKIE } from "./session-cookie";
const SECRET = process.env.SESSION_SECRET ?? "dev-insecure-secret-change-me";

/** Sign `<base64url(token)>.<hmac>` so the value is tamper-evident. */
export function signSession(token: string): string {
  const b64 = Buffer.from(token).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

/** Return the embedded token iff the signature verifies, else null. */
export function readSession(cookie: string | undefined): string | null {
  if (!cookie) return null;
  const [b64, sig] = cookie.split(".");
  if (!b64 || !sig) return null;
  const expected = createHmac("sha256", SECRET).update(b64).digest("base64url");
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  return Buffer.from(b64, "base64url").toString("utf8");
}

/** Presence + signature check (no token needed). Used where we only gate access. */
export function verifySession(cookie: string | undefined): boolean {
  return readSession(cookie) !== null;
}

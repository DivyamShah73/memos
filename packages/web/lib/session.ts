/**
 * Lightweight signed-cookie session for the demo operator login. This is a portfolio gate, not
 * production auth (documented in ADR-007): one shared credential (DEMO_PASSWORD), an HMAC-signed
 * cookie so it can't be trivially forged. Uses node:crypto, so these run in the Node runtime
 * (server components / actions / route handlers) — middleware does a cheap presence check only.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export { SESSION_COOKIE } from "./session-cookie";
const SECRET = process.env.SESSION_SECRET ?? "dev-insecure-secret-change-me";

export function signSession(): string {
  const payload = `operator:${Date.now()}`;
  const b64 = Buffer.from(payload).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

export function verifySession(cookie: string | undefined): boolean {
  if (!cookie) return false;
  const [b64, sig] = cookie.split(".");
  if (!b64 || !sig) return false;
  const expected = createHmac("sha256", SECRET).update(b64).digest("base64url");
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

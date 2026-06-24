/**
 * Signed-cookie session for the dashboard (Phase 13 / ADR-011). The cookie carries the user's
 * gateway session token (minted by the `user.login` intent), HMAC-signed so it can't be forged and
 * httpOnly so JS can't read it. The server reads the token back out to call the gateway AS that user
 * — so the dashboard is scoped by the logged-in person's role + projects, not a shared operator.
 * Uses node:crypto → Node runtime only (server components / actions / route handlers); the edge
 * middleware does a cheap presence check via SESSION_COOKIE.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { SESSION_COOKIE } from "./session-cookie";

export { SESSION_COOKIE };
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

/**
 * Whether the session cookie carries the `Secure` flag. On by default in production so the token
 * never rides plaintext (review M1) — Vercel/Render serve the dashboard over HTTPS, so this is right.
 * `COOKIE_INSECURE=1` is a TEST-ONLY escape hatch: the e2e drives the *production build* over
 * http://localhost, where a Secure cookie can't round-trip. NEVER set COOKIE_INSECURE in a deployed
 * environment — it is unset on Vercel/Render, so production stays Secure.
 */
export function cookieSecure(): boolean {
  if (process.env.COOKIE_INSECURE === "1") return false;
  return process.env.NODE_ENV === "production";
}

/** Minimal jar shape we write to (next/headers `cookies()`); kept loose to avoid a Next type import. */
type CookieSetter = { set(name: string, value: string, opts: Record<string, unknown>): void };

/**
 * Sign `token` into the session cookie with the canonical attributes (httpOnly, sameSite, secure,
 * 8h maxAge). Single source of truth for the login + signup flows — change the policy here once.
 */
export function setSessionCookie(jar: CookieSetter, token: string): void {
  jar.set(SESSION_COOKIE, signSession(token), {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(), // HTTPS-only in prod (review M1); test-only opt-out for e2e over http
    path: "/",
    maxAge: 60 * 60 * 8,
  });
}

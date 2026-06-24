import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session-cookie";

// Pages reachable without a session (and that an authenticated user is bounced away from).
// Add a new public auth page (e.g. /forgot-password) here — the conditionals below need no edit.
const AUTH_PATHS = ["/login", "/signup"];

// Cheap presence check (edge runtime can't use node:crypto). The signature is verified in the
// dashboard layout (Node runtime). Unauthenticated → /login; authenticated visiting an auth page → /.
export function middleware(req: NextRequest) {
  const hasSession = req.cookies.has(SESSION_COOKIE);
  const p = req.nextUrl.pathname;
  const isAuthPage = AUTH_PATHS.some((path) => p.startsWith(path));

  if (!hasSession && !isAuthPage) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (hasSession && isAuthPage) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Exclude /api/* — those are route handlers that authenticate themselves and must return their own
  // JSON status (e.g. 401), not a 302 HTML redirect to /login (which a fetch/EventSource can't parse).
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};

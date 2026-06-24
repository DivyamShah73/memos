import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session-cookie";

// Cheap presence check (edge runtime can't use node:crypto). The signature is verified in the
// dashboard layout (Node runtime). Unauthenticated → /login; authenticated visiting an auth page → /.
// /login and /signup are the unauthenticated-allowed pages (Phase 15 adds public signup).
export function middleware(req: NextRequest) {
  const hasSession = req.cookies.has(SESSION_COOKIE);
  const p = req.nextUrl.pathname;
  const isAuthPage = p.startsWith("/login") || p.startsWith("/signup");

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
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session-cookie";

// Cheap presence check (edge runtime can't use node:crypto). The signature is verified in the
// dashboard layout (Node runtime). Unauthenticated → /login; authenticated visiting /login → /.
export function middleware(req: NextRequest) {
  const hasSession = req.cookies.has(SESSION_COOKIE);
  const isLogin = req.nextUrl.pathname.startsWith("/login");

  if (!hasSession && !isLogin) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (hasSession && isLogin) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

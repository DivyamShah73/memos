import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { signSession, SESSION_COOKIE, cookieSecure } from "@/lib/session";
import { API_URL } from "@/lib/memos";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  async function login(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    // Authenticate against the gateway's user.login intent → a user session token, stored signed in
    // the cookie. The dashboard then calls the gateway AS this user (their role + project scope).
    const res = await fetch(`${API_URL}/v1/intent/user.login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });
    const json = (await res.json()) as { ok: boolean; data?: { api_token: { raw: string } } };
    if (!json.ok || !json.data) redirect("/login?error=1");
    const jar = await cookies();
    jar.set(SESSION_COOKIE, signSession(json.data!.api_token.raw), {
      httpOnly: true,
      sameSite: "lax",
      secure: cookieSecure(), // HTTPS-only in prod (review M1); test-only opt-out for e2e over http
      path: "/",
      maxAge: 60 * 60 * 8,
    });
    redirect("/");
  }

  const field =
    "w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent";

  return (
    <main className="min-h-screen grid place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 text-fg font-semibold text-lg tracking-tight">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-accent/15 text-accent font-mono">M</span>
            MemOS
          </div>
          <p className="mt-2 text-sm text-muted">Operator Console</p>
        </div>

        <form action={login} className="rounded-xl border border-border bg-surface/70 p-6 backdrop-blur">
          <label htmlFor="email" className="block text-xs font-medium text-muted mb-2">Email</label>
          <input id="email" name="email" type="email" autoFocus placeholder="you@org.com" className={field} />
          <label htmlFor="password" className="mt-4 block text-xs font-medium text-muted mb-2">Password</label>
          <input id="password" name="password" type="password" placeholder="••••••••" className={field} />
          {params.error ? (
            <p className="mt-2 text-xs text-danger">Incorrect email or password. Try again.</p>
          ) : null}
          <button
            type="submit"
            className="mt-4 w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-bg transition hover:opacity-90"
          >
            Sign in
          </button>
          <p className="mt-3 text-center text-[11px] text-muted leading-relaxed">
            Demo: <code className="font-mono text-fg/80">ceo@acme.test</code> /
            <code className="font-mono text-fg/80"> demo-ceo-pass</code> (CEO, read-only org-wide)<br />
            or <code className="font-mono text-fg/80">manager@acme.test</code> /
            <code className="font-mono text-fg/80"> demo-manager-pass</code>
          </p>
        </form>

        <p className="mt-4 text-center text-xs text-muted">
          New here?{" "}
          <Link href="/signup" className="text-accent hover:underline">Create an organization</Link>
        </p>
      </div>
    </main>
  );
}

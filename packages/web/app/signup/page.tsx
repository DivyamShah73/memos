import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { signSession, SESSION_COOKIE, cookieSecure } from "@/lib/session";
import { API_URL } from "@/lib/memos";

export const dynamic = "force-dynamic";

/**
 * Public self-serve signup (Phase 15). Creates a brand-new org + its first CEO via the public
 * org.signup intent, then signs the returned session token into the cookie and drops you on the
 * dashboard — same cookie handling as the login page.
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  async function signup(formData: FormData) {
    "use server";
    const org_name = String(formData.get("org_name") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const display_name = String(formData.get("display_name") ?? "").trim();
    if (!org_name || !email || password.length < 8) redirect("/signup?error=1");

    const res = await fetch(`${API_URL}/v1/intent/org.signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ org_name, email, password, display_name: display_name || undefined }),
      cache: "no-store",
    });
    const json = (await res.json()) as { ok: boolean; data?: { api_token: { raw: string } } };
    if (!json.ok || !json.data) redirect("/signup?error=1");
    const jar = await cookies();
    jar.set(SESSION_COOKIE, signSession(json.data!.api_token.raw), {
      httpOnly: true,
      sameSite: "lax",
      secure: cookieSecure(),
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
          <p className="mt-2 text-sm text-muted">Create an organization</p>
        </div>

        <form action={signup} className="rounded-xl border border-border bg-surface/70 p-6 backdrop-blur">
          <label htmlFor="org_name" className="block text-xs font-medium text-muted mb-2">Organization name</label>
          <input id="org_name" name="org_name" type="text" autoFocus placeholder="Acme Inc." className={field} />
          <label htmlFor="display_name" className="mt-4 block text-xs font-medium text-muted mb-2">Your name</label>
          <input id="display_name" name="display_name" type="text" placeholder="Jane Doe" className={field} />
          <label htmlFor="email" className="mt-4 block text-xs font-medium text-muted mb-2">Email</label>
          <input id="email" name="email" type="email" placeholder="you@org.com" className={field} />
          <label htmlFor="password" className="mt-4 block text-xs font-medium text-muted mb-2">Password</label>
          <input id="password" name="password" type="password" placeholder="at least 8 characters" className={field} />
          {params.error ? (
            <p className="mt-2 text-xs text-danger">Could not create the organization. Check the fields (password ≥ 8 chars) and try again.</p>
          ) : null}
          <button
            type="submit"
            className="mt-4 w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-bg transition hover:opacity-90"
          >
            Create organization
          </button>
          <p className="mt-3 text-center text-[11px] text-muted">
            You&apos;ll be the CEO (read-only, org-wide) and can invite your team.
          </p>
        </form>

        <p className="mt-4 text-center text-xs text-muted">
          Already have an account?{" "}
          <Link href="/login" className="text-accent hover:underline">Sign in</Link>
        </p>
      </div>
    </main>
  );
}

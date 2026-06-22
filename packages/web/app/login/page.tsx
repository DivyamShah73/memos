import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { signSession, SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  async function login(formData: FormData) {
    "use server";
    const password = String(formData.get("password") ?? "");
    const expected = process.env.DEMO_PASSWORD ?? "memos";
    if (password !== expected) redirect("/login?error=1");
    const jar = await cookies();
    jar.set(SESSION_COOKIE, signSession(), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 8,
    });
    redirect("/");
  }

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

        <form
          action={login}
          className="rounded-xl border border-border bg-surface/70 p-6 backdrop-blur"
        >
          <label htmlFor="password" className="block text-xs font-medium text-muted mb-2">
            Operator password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoFocus
            placeholder="••••••••"
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
          />
          {params.error ? (
            <p className="mt-2 text-xs text-danger">Incorrect password. Try again.</p>
          ) : null}
          <button
            type="submit"
            className="mt-4 w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-bg transition hover:opacity-90"
          >
            Sign in
          </button>
          <p className="mt-3 text-center text-[11px] text-muted">
            Demo gate — default password <code className="font-mono text-fg/80">memos</code>
          </p>
        </form>
      </div>
    </main>
  );
}

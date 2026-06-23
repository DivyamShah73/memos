import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { callIntent, getProjectId, getUserProjects } from "@/lib/memos";
import type { AgentContext } from "@/lib/types";
import { SidebarNav } from "@/components/sidebar-nav";
import { ProjectSwitcher } from "@/components/project-switcher";

export const dynamic = "force-dynamic";

async function logout() {
  "use server";
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  if (!verifySession(jar.get(SESSION_COOKIE)?.value)) redirect("/login");

  // Everything below reads AS the logged-in user (their token is in the session cookie), so the
  // sidebar identity, the project list, and every page are scoped to that person (Phase 13/ADR-011).
  let ctx: AgentContext | null = null;
  try {
    ctx = await callIntent<AgentContext>("agent.me");
  } catch {
    ctx = null;
  }
  const [project, projects] = await Promise.all([getProjectId(), getUserProjects()]);

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r border-border bg-surface/50 p-4 md:flex md:flex-col">
        <div className="mb-8 flex items-center gap-2 px-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-accent/15 text-accent font-mono">M</span>
          MemOS
        </div>
        <SidebarNav />
        <div className="mt-auto space-y-2">
          <div className="rounded-lg border border-border bg-bg/50 p-3 text-[11px] text-muted">
            <div className="text-fg/80">{ctx?.org_id ?? "org"}</div>
            <div className="mt-0.5">{projects.length} project{projects.length === 1 ? "" : "s"} in scope</div>
          </div>
          <form action={logout}>
            <button className="w-full rounded-lg border border-border px-3 py-1.5 text-[11px] text-muted transition hover:text-fg hover:border-muted">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h1 className="text-base font-semibold tracking-tight">Operator Console</h1>
            <p className="text-xs text-muted">{ctx?.org_id ?? "org"}</p>
          </div>
          <div className="flex items-center gap-3">
            <ProjectSwitcher projects={projects} selected={project} />
            <span className="flex items-center gap-2 text-xs text-muted">
              <span className="h-2 w-2 rounded-full bg-accent-2 animate-pulse-dot" />
              live
            </span>
          </div>
        </header>
        <div className="flex-1 overflow-auto p-6">{children}</div>
      </div>
    </div>
  );
}

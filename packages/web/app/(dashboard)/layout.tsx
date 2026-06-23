import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { callIntent, getProjectId } from "@/lib/memos";
import type { AgentContext } from "@/lib/types";
import { SidebarNav } from "@/components/sidebar-nav";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  if (!verifySession(jar.get(SESSION_COOKIE)?.value)) redirect("/login");

  let ctx: AgentContext | null = null;
  try {
    ctx = await callIntent<AgentContext>("agent.me");
  } catch {
    ctx = null;
  }
  const project = getProjectId();

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-border bg-surface/50 p-4 md:flex md:flex-col">
        <div className="mb-8 flex items-center gap-2 px-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-accent/15 text-accent font-mono">M</span>
          MemOS
        </div>
        <SidebarNav />
        <div className="mt-auto rounded-lg border border-border bg-bg/50 p-3 text-[11px] text-muted">
          <div className="text-fg/80">{ctx?.agent_id ?? "operator"}</div>
          <div className="mt-0.5">{ctx?.org_id ?? "org"} · {ctx?.team_id ?? "team"}</div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h1 className="text-base font-semibold tracking-tight">Operator Console</h1>
            <p className="text-xs text-muted">{project}</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="h-2 w-2 rounded-full bg-accent-2 animate-pulse-dot" />
            live
          </div>
        </header>
        <div className="flex-1 overflow-auto p-6">{children}</div>
      </div>
    </div>
  );
}

import { revalidatePath } from "next/cache";
import { callIntent, getUserProjects } from "@/lib/memos";
import type { AgentContext } from "@/lib/types";
import { MintCodeForm } from "@/components/mint-code-form";
import { relativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface Member {
  user_id: string;
  email: string;
  display_name: string;
  status: string;
  memberships: { role: string; scope_kind: string; scope_id: string }[];
}
interface AgentRow {
  agent_id: string;
  display_name: string;
  role: string;
  status: string;
  scopes: string[];
  trust_score: number;
  last_checkin_at: string | null;
}

const field =
  "w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent";
const card = "rounded-xl border border-border bg-surface/70 p-4";

export default async function AdminPage() {
  let me: AgentContext | null = null;
  try {
    me = await callIntent<AgentContext>("agent.me");
  } catch {
    me = null;
  }
  const role = me?.role;

  // Role gate (defense-in-depth — the API also denies non-admins via ADMIN_INTENTS).
  if (role !== "manager" && role !== "ceo") {
    return (
      <div className={`${card} max-w-md`}>
        <h2 className="text-base font-semibold">Admin</h2>
        <p className="mt-2 text-sm text-muted">
          You need the manager or CEO role to administer this organization.
        </p>
      </div>
    );
  }

  const projects = await getUserProjects();
  const [members, agentList] = await Promise.all([
    callIntent<{ members: Member[] }>("member.list").then((r) => r.members).catch(() => [] as Member[]),
    callIntent<{ agents: AgentRow[] }>("agent.list").then((r) => r.agents).catch(() => [] as AgentRow[]),
  ]);

  // No-escalation: you can only grant a role ≤ your own (the API enforces it too).
  const grantableRoles = role === "ceo" ? ["member", "manager", "ceo"] : ["member", "manager"];

  async function invite(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const display_name = String(formData.get("display_name") ?? "").trim();
    const inviteRole = String(formData.get("role") ?? "member");
    const scope_kind = String(formData.get("scope_kind") ?? "project");
    const scope_id = String(formData.get("scope_id") ?? "").trim();
    if (!email || password.length < 8 || !display_name || !scope_id) return;
    try {
      await callIntent("user.invite", {
        email, password, display_name, role: inviteRole, scope_kind, scope_id,
      });
      revalidatePath("/admin");
    } catch {
      /* business-rule rejection (e.g. escalation/scope) — page re-renders unchanged */
    }
  }

  async function offboard(formData: FormData) {
    "use server";
    const user_id = String(formData.get("user_id") ?? "");
    if (!user_id) return;
    try {
      await callIntent("member.offboard", { user_id });
      revalidatePath("/admin");
    } catch {
      /* ignore */
    }
  }

  async function revoke(formData: FormData) {
    "use server";
    const agent_id = String(formData.get("agent_id") ?? "");
    if (!agent_id) return;
    try {
      await callIntent("agent.revoke", { agent_id });
      revalidatePath("/admin");
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Organization admin</h1>
        <p className="text-xs text-muted">{me?.org_id} · you are {role}</p>
      </div>

      {/* Members */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-fg/90">Members</h2>
        <div className={`${card} overflow-x-auto p-0`}>
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
              <tr className="border-b border-border">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Roles</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {members.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-3 text-muted">No members yet.</td></tr>
              ) : (
                members.map((m) => (
                  <tr key={m.user_id} className="border-b border-border/50">
                    <td className="px-4 py-2">{m.display_name}</td>
                    <td className="px-4 py-2 text-muted">{m.email}</td>
                    <td className="px-4 py-2 text-muted">
                      {m.memberships.map((x) => `${x.role}@${x.scope_id}`).join(", ") || "—"}
                    </td>
                    <td className="px-4 py-2">
                      <span className={m.status === "active" ? "text-accent-2" : "text-danger"}>{m.status}</span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      {m.status === "active" ? (
                        <form action={offboard}>
                          <input type="hidden" name="user_id" value={m.user_id} />
                          <button className="rounded border border-border px-2 py-1 text-[11px] text-muted transition hover:text-danger hover:border-danger">
                            Offboard
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Invite */}
        <form action={invite} className={`${card} space-y-3`}>
          <div className="text-xs font-medium text-muted">Invite a member</div>
          <div className="grid grid-cols-2 gap-2">
            <input name="display_name" placeholder="Name" className={field} />
            <input name="email" type="email" placeholder="email@org.com" className={field} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input name="password" type="password" placeholder="initial password (≥ 8 chars)" className={field} />
            <select name="role" defaultValue="member" className={field}>
              {grantableRoles.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select name="scope_kind" defaultValue="project" className={field}>
              <option value="project">project</option>
              <option value="team">team</option>
              <option value="org">org</option>
            </select>
            <input name="scope_id" defaultValue={projects[0] ?? ""} placeholder="scope id" className={field} />
          </div>
          <button type="submit" className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-bg transition hover:opacity-90">
            Send invite
          </button>
          <p className="text-[11px] text-muted">
            The person signs in with this email + initial password. You can grant up to your own role.
          </p>
        </form>
      </section>

      {/* Agents */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-fg/90">Agents</h2>
        <div className={`${card} overflow-x-auto p-0`}>
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
              <tr className="border-b border-border">
                <th className="px-4 py-2 font-medium">Agent</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">Trust</th>
                <th className="px-4 py-2 font-medium">Last seen</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {agentList.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-3 text-muted">No agents yet.</td></tr>
              ) : (
                agentList.map((a) => (
                  <tr key={a.agent_id} className="border-b border-border/50">
                    <td className="px-4 py-2">{a.display_name}</td>
                    <td className="px-4 py-2 text-muted">{a.role}</td>
                    <td className="px-4 py-2 text-muted">{a.trust_score.toFixed(2)}</td>
                    <td className="px-4 py-2 text-muted">{a.last_checkin_at ? relativeTime(a.last_checkin_at) : "never"}</td>
                    <td className="px-4 py-2">
                      <span className={a.status === "active" ? "text-accent-2" : "text-danger"}>{a.status}</span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      {a.status === "active" ? (
                        <form action={revoke}>
                          <input type="hidden" name="agent_id" value={a.agent_id} />
                          <button className="rounded border border-border px-2 py-1 text-[11px] text-muted transition hover:text-danger hover:border-danger">
                            Revoke
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Enrollment codes */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-fg/90">Enroll an agent</h2>
        <div className={`${card} max-w-md`}>
          <p className="mb-3 text-xs text-muted">
            Mint a single-use code for a project, then give it to an agent to enroll.
          </p>
          <MintCodeForm projects={projects} roles={grantableRoles} />
        </div>
      </section>
    </div>
  );
}

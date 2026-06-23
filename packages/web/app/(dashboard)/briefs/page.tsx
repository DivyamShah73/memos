import { revalidatePath } from "next/cache";
import { callIntent } from "@/lib/memos";
import { relativeTime } from "@/lib/utils";
import type { BriefRow } from "@/lib/types";

export const dynamic = "force-dynamic";
const PROJECT = process.env.MEMOS_PROJECT_ID ?? "project.demo";

async function createBrief(formData: FormData) {
  "use server";
  const target_kind = String(formData.get("target_kind") ?? "project");
  const target_id = String(formData.get("target_id") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!target_id || !title || !body) return;
  await callIntent("brief.create", { target_kind, target_id, title, body });
  revalidatePath("/briefs");
}

export default async function BriefsPage() {
  const { briefs } = await callIntent<{ briefs: BriefRow[] }>("brief.fetch", {
    project_id: PROJECT,
  }).catch(() => ({ briefs: [] as BriefRow[] }));

  const field = "w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent";

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section>
        <h2 className="mb-3 text-sm font-medium text-muted">Author a brief</h2>
        <form action={createBrief} className="space-y-3 rounded-xl border border-border bg-surface/70 p-4">
          <div className="grid grid-cols-3 gap-2">
            <select name="target_kind" defaultValue="project" className={field}>
              <option value="org">org</option>
              <option value="team">team</option>
              <option value="project">project</option>
              <option value="agent">agent</option>
            </select>
            <input name="target_id" defaultValue={PROJECT} placeholder="target id" className={`col-span-2 ${field}`} />
          </div>
          <input name="title" placeholder="Title" className={field} />
          <textarea name="body" placeholder="Standing instruction (markdown)…" rows={4} className={field} />
          <button type="submit" className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-bg transition hover:opacity-90">
            Publish brief
          </button>
        </form>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted">Standing briefs</h2>
        <ul className="space-y-2">
          {briefs.map((b) => (
            <li key={b.id} className="rounded-xl border border-border bg-surface/70 p-4">
              <div className="flex items-center gap-2">
                <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] uppercase text-accent">
                  {b.target_kind}
                </span>
                <span className="truncate text-sm font-medium text-fg">{b.title}</span>
              </div>
              <p className="mt-1.5 line-clamp-3 text-sm text-fg/80">{b.body}</p>
              <p className="mt-1 text-[11px] text-muted">→ {b.target_id} · {relativeTime(b.created_at)}</p>
            </li>
          ))}
          {briefs.length === 0 ? (
            <li className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
              No briefs addressed to you yet. Author one (target the project) to see it here.
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}

import Link from "next/link";
import { callIntent, getProjectId } from "@/lib/memos";
import { cn } from "@/lib/utils";
import type { LearningListItem, ProvEdge, ProvNode } from "@/lib/types";
import { ProvenanceGraph } from "@/components/provenance-graph";

export const dynamic = "force-dynamic";
const PROJECT = getProjectId();

export default async function ProvenancePage({
  searchParams,
}: {
  searchParams: Promise<{ learning?: string }>;
}) {
  const { learning } = await searchParams;
  const list = await callIntent<{ learnings: LearningListItem[] }>("learning.list", {
    project_id: PROJECT,
  }).catch(() => ({ learnings: [] as LearningListItem[] }));

  const selected = learning ?? list.learnings[0]?.id;
  let graph: { nodes: ProvNode[]; edges: ProvEdge[] } = { nodes: [], edges: [] };
  if (selected) {
    graph = await callIntent<{ nodes: ProvNode[]; edges: ProvEdge[] }>("provenance.trace", {
      project_id: PROJECT,
      learning_id: selected,
    }).catch(() => ({ nodes: [], edges: [] }));
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <aside>
        <h2 className="mb-3 text-sm font-medium text-muted">Learnings (by reuse)</h2>
        <ul className="space-y-2">
          {list.learnings.map((l) => (
            <li key={l.id}>
              <Link
                href={`/provenance?learning=${l.id}`}
                className={cn(
                  "block rounded-lg border p-3 transition",
                  l.id === selected
                    ? "border-accent bg-surface"
                    : "border-border bg-surface/50 hover:border-muted",
                )}
              >
                <p className="text-sm text-fg/90">{l.claim}</p>
                <p className="mt-1 flex items-center gap-2 text-[11px] text-muted">
                  <span className="font-mono">reuse {l.reuse_success_count}</span>
                  {l.has_evidence ? (
                    <span className="rounded bg-accent-2/15 px-1.5 py-0.5 text-accent-2">evidence</span>
                  ) : (
                    <span className="rounded bg-border px-1.5 py-0.5">no evidence</span>
                  )}
                </p>
              </Link>
            </li>
          ))}
          {list.learnings.length === 0 ? (
            <li className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted">
              No learnings yet — run <code className="font-mono">pnpm db:seed</code>.
            </li>
          ) : null}
        </ul>
      </aside>

      <section className="lg:col-span-2">
        <h2 className="mb-3 text-sm font-medium text-muted">Provenance lineage</h2>
        <ProvenanceGraph nodes={graph.nodes} edges={graph.edges} />
      </section>
    </div>
  );
}

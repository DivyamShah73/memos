"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { LearningListItem, ProvEdge, ProvNode } from "@/lib/types";
import { ProvenanceGraph } from "@/components/provenance-graph";

type Lineage = { nodes: ProvNode[]; edges: ProvEdge[] };

/**
 * Client-side provenance explorer. The server prefetches every learning's lineage once and hands
 * them here as a map, so selecting a learning is instant (no per-click round-trip across the
 * Vercel → Render → Neon hop). The URL is kept shareable via history.replaceState — no navigation,
 * so no server re-render/refetch.
 */
export function ProvenanceExplorer({
  learnings,
  lineages,
  initialId,
}: {
  learnings: LearningListItem[];
  lineages: Record<string, Lineage>;
  initialId?: string;
}) {
  const [selected, setSelected] = useState<string | undefined>(initialId ?? learnings[0]?.id);
  const graph = (selected && lineages[selected]) || { nodes: [], edges: [] };

  function select(id: string) {
    setSelected(id);
    window.history.replaceState(null, "", `/provenance?learning=${id}`);
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <aside>
        <h2 className="mb-3 text-sm font-medium text-muted">Learnings (by reuse)</h2>
        <ul className="space-y-2">
          {learnings.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                onClick={() => select(l.id)}
                className={cn(
                  "block w-full rounded-lg border p-3 text-left transition",
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
              </button>
            </li>
          ))}
          {learnings.length === 0 ? (
            <li className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted">
              No learnings yet — run <code className="font-mono">pnpm db:seed</code>.
            </li>
          ) : null}
        </ul>
      </aside>

      <section className="lg:col-span-2">
        <h2 className="mb-3 text-sm font-medium text-muted">Provenance lineage</h2>
        {/* key={selected} remounts React Flow so fitView re-runs for each learning's layout */}
        <ProvenanceGraph key={selected} nodes={graph.nodes} edges={graph.edges} />
      </section>
    </div>
  );
}

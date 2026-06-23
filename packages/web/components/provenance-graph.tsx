"use client";

import { ReactFlow, Background, Controls, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ProvEdge, ProvNode } from "@/lib/types";

// Each node type sits in its own column so the chain reads left→right.
const COL: Record<string, number> = { learning: 0, artifact: 1, run: 2, objective: 3, agent: 4 };
const COLOR: Record<string, string> = {
  learning: "#7c8cff",
  artifact: "#34d399",
  run: "#8a92a6",
  objective: "#fbbf24",
  agent: "#e7eaf3",
};

export function ProvenanceGraph({ nodes, edges }: { nodes: ProvNode[]; edges: ProvEdge[] }) {
  if (nodes.length === 0) {
    return (
      <div className="grid h-[520px] place-items-center rounded-xl border border-dashed border-border text-sm text-muted">
        Select a learning to trace its lineage.
      </div>
    );
  }

  const rowByCol: Record<number, number> = {};
  const rfNodes: Node[] = nodes.map((n) => {
    const col = COL[n.type] ?? 0;
    const row = rowByCol[col] ?? 0;
    rowByCol[col] = row + 1;
    return {
      id: n.id,
      position: { x: col * 240, y: row * 120 + 20 },
      data: {
        label: (
          <div className="text-left">
            <div className="text-[9px] uppercase tracking-wide opacity-60">{n.type}</div>
            <div className="text-xs leading-snug">{n.label}</div>
          </div>
        ),
      },
      style: {
        background: "#12141c",
        color: "#e7eaf3",
        border: `1px solid ${COLOR[n.type] ?? "#252a38"}`,
        borderRadius: 10,
        padding: 8,
        width: 200,
      },
    };
  });

  const rfEdges: Edge[] = edges.map((e, i) => ({
    id: `e${i}`,
    source: e.from,
    target: e.to,
    label: e.label,
    animated: true,
    style: { stroke: "#3a4156" },
    labelStyle: { fill: "#8a92a6", fontSize: 10 },
    labelBgStyle: { fill: "#0a0b0f" },
  }));

  return (
    <div className="h-[520px] overflow-hidden rounded-xl border border-border bg-surface/40">
      <ReactFlow nodes={rfNodes} edges={rfEdges} fitView minZoom={0.3}>
        <Background color="#252a38" gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

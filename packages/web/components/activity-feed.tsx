"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn, relativeTime } from "@/lib/utils";
import type { ActivityItem } from "@/lib/types";

type Keyed = ActivityItem & { _k: string };

const CHIP: Record<string, string> = {
  fact: "bg-accent/15 text-accent",
  learning: "bg-accent-2/15 text-accent-2",
  checkin: "bg-border text-muted",
  milestone: "bg-warn/15 text-warn",
};

export function ActivityFeed({ projectId, initial }: { projectId: string; initial: ActivityItem[] }) {
  const idRef = useRef(0);
  const [items, setItems] = useState<Keyed[]>(() =>
    initial.map((it) => ({ ...it, _k: `init-${idRef.current++}` })),
  );

  useEffect(() => {
    const es = new EventSource(`/api/stream?project_id=${encodeURIComponent(projectId)}`);
    es.addEventListener("activity", (e) => {
      try {
        const ev = JSON.parse((e as MessageEvent).data);
        const item: Keyed = {
          type: ev.type,
          summary: ev.summary,
          agent_id: ev.agentId ?? null,
          bd_id: ev.bdId ?? null,
          created_at: ev.ts,
          _k: `live-${idRef.current++}`,
        };
        setItems((prev) => [item, ...prev].slice(0, 50));
      } catch {
        /* ignore malformed frame */
      }
    });
    return () => es.close();
  }, [projectId]);

  return (
    <div className="rounded-xl border border-border bg-surface/70">
      <ul className="max-h-[70vh] divide-y divide-border/60 overflow-auto">
        <AnimatePresence initial={false}>
          {items.map((it) => (
            <motion.li
              key={it._k}
              initial={{ opacity: 0, y: -8, backgroundColor: "rgba(124,140,255,0.08)" }}
              animate={{ opacity: 1, y: 0, backgroundColor: "rgba(0,0,0,0)" }}
              transition={{ duration: 0.4 }}
              className="flex items-start gap-3 px-4 py-3"
            >
              <span
                className={cn(
                  "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
                  CHIP[it.type] ?? "bg-border text-muted",
                )}
              >
                {it.type}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-fg/90">{it.summary}</p>
                <p className="mt-0.5 text-[11px] text-muted">
                  {it.agent_id ?? "agent"} · {relativeTime(it.created_at)}
                </p>
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
        {items.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-muted">No activity yet.</li>
        ) : null}
      </ul>
    </div>
  );
}

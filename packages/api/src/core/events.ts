/**
 * In-process activity event bus (Phase 7). The gateway is a single process, so an in-memory
 * EventEmitter is the right tool to fan recent writes out to connected SSE clients (the live
 * dashboard feed) — no Redis/queue needed (ADR-007). For a multi-instance deploy this would
 * move to Postgres LISTEN/NOTIFY or Redis pub/sub; the publish/subscribe seam here stays the same.
 *
 * Events are published by the write handlers AFTER their withScope transaction commits, so the
 * feed never shows a rolled-back write. Subscribers (the SSE route) filter by project themselves.
 */
import { EventEmitter } from "node:events";

export interface ActivityEvent {
  type: "checkin" | "fact" | "learning" | "milestone";
  projectId: string;
  agentId: string | null;
  summary: string;
  ts: string; // ISO timestamp
  bdId?: string | null;
}

const CHANNEL = "activity";
const bus = new EventEmitter();
bus.setMaxListeners(0); // one listener per connected SSE client; don't warn on many

/** Publish an activity event to all subscribers. Call only after the write has committed. */
export function publishActivity(event: ActivityEvent): void {
  bus.emit(CHANNEL, event);
}

/** Subscribe to activity events; returns an unsubscribe function (call on disconnect).
 * The listener is wrapped so a throwing subscriber can never escape into publishActivity's
 * caller — publish runs post-commit in the write handlers, so a subscriber error must not turn
 * an already-committed write into a 500. */
export function subscribeActivity(listener: (event: ActivityEvent) => void): () => void {
  const safe = (event: ActivityEvent): void => {
    try {
      listener(event);
    } catch (err) {
      console.error("activity subscriber error:", err);
    }
  };
  bus.on(CHANNEL, safe);
  return () => bus.off(CHANNEL, safe);
}

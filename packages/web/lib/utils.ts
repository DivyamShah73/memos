import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Shared form-input styling (login, signup, admin, mint-code). One place to change the design. */
export const fieldClass =
  "w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent";

/**
 * Whether a role can administer the org — single source of truth for the web layer, mirroring the
 * API's ADMIN_INTENTS tier. Used by the sidebar gate and the admin page's role check.
 */
export function canAdmin(role: string | undefined): boolean {
  return role === "manager" || role === "ceo";
}

/** "3m ago" style relative time. */
export function relativeTime(iso: string | Date): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

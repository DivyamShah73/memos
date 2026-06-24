"use client";

import { useState } from "react";

const field =
  "w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent";

/**
 * Mint an agent enrollment code and show it once, with copy-to-clipboard (Phase 15). Posts to the
 * /api/admin/enroll route handler (which calls the gateway with the user's session token). The code
 * is single-use; the agent enrolls with it via the SDK / agent.enroll.
 */
export function MintCodeForm({ projects, roles }: { projects: string[]; roles: string[] }) {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setCode(null);
    setCopied(false);
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/admin/enroll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project_id: fd.get("project_id"), role: fd.get("role") }),
      });
      const json = (await res.json()) as { ok: boolean; data?: { code: string }; error?: string };
      if (json.ok && json.data) setCode(json.data.code);
      else setError(json.error ?? "could not mint a code");
    } catch {
      setError("could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the code is visible to copy manually */
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <select name="project_id" defaultValue={projects[0] ?? ""} className={field}>
          {projects.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select name="role" defaultValue="member" className={field}>
          {roles.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={busy || projects.length === 0}
        className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-bg transition hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Minting…" : "Mint enrollment code"}
      </button>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      {code ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-bg/50 p-2">
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-fg">{code}</code>
          <button
            type="button"
            onClick={copy}
            className="shrink-0 rounded border border-border px-2 py-1 text-[11px] text-muted transition hover:text-fg"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : null}
    </form>
  );
}

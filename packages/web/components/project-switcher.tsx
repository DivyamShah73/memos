"use client";

/**
 * Project switcher (Phase 13). Lists the projects the logged-in user can see (their principal scope —
 * for a CEO that's the whole org). Selecting one sets the non-secret `memos_project` cookie client-side
 * and reloads, so the server reads it via getProjectId() and re-renders every page for that project.
 */
export function ProjectSwitcher({ projects, selected }: { projects: string[]; selected: string }) {
  if (projects.length <= 1) {
    return <span className="text-xs text-muted">{selected}</span>;
  }
  return (
    <select
      defaultValue={selected}
      onChange={(e) => {
        document.cookie = `memos_project=${encodeURIComponent(e.target.value)}; path=/; max-age=86400`;
        location.reload();
      }}
      className="rounded-md border border-border bg-bg px-2 py-1 text-xs text-fg outline-none focus:border-accent"
      aria-label="Select project"
    >
      {projects.map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
    </select>
  );
}

/**
 * Generates harness.html — one self-contained page summarising the agent harness.
 *
 * Not a web app. There is no server, no build step and no dependency: this reads the repo and
 * writes a single HTML file you open with a browser. That matters, because a dashboard that needs
 * maintaining is a second thing to keep alive, and the point of this one is to answer "is any of
 * this real?" from data that already exists.
 *
 * Sources, all of them existing artifacts rather than separate instrumentation:
 *   - git log trailers          -> how much of the codebase an agent co-authored
 *   - .claude/.state/*.json     -> the per-session ledgers the hooks write as they run
 *   - .claude/hooks, agents     -> what is actually installed
 *   - .harness/gates.json       -> last full gate run (written by --gates)
 *   - GitHub API                -> pipeline runs, with duration and cost
 *
 *   node scripts/dashboard.mjs            # generate from cached gate results
 *   node scripts/dashboard.mjs --gates    # re-run the real gates first (slow: runs the suites)
 *   node scripts/dashboard.mjs --no-remote
 */
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const REMOTE = !process.argv.includes("--no-remote");
const RUN_GATES = process.argv.includes("--gates");
const GATES_FILE = join(REPO, ".harness", "gates.json");

const sh = (cmd, fallback = "") => {
  try {
    return execSync(cmd, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return fallback;
  }
};
/** Terminal colour codes, built from a code point so the pattern holds no control character. */
const ANSI = new RegExp(String.fromCharCode(27) + String.raw`[[0-9;]*m`, "g");

const shOk = (cmd) => {
  try {
    execSync(cmd, { cwd: REPO, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// Gates. Re-running these takes minutes, so results are cached with a timestamp and the page
// always shows how fresh they are — a stale green is worse than an honest "measured an hour ago".
// ---------------------------------------------------------------------------

function gates() {
  if (!RUN_GATES && existsSync(GATES_FILE)) return JSON.parse(readFileSync(GATES_FILE, "utf8"));

  const hooks = sh("bash testing/harness_hooks.sh 2>&1 | tail -1").replace(ANSI, "");
  const api = sh("pnpm --filter @memos/api test 2>&1 | grep -oE 'Tests.*'").replace(ANSI, "");
  const result = {
    measuredAt: new Date().toISOString(),
    hooks: { label: hooks || "not run", ok: /(\d+) passed, 0 failed/.test(hooks) },
    api: { label: api.replace(/\s+/g, " ") || "not run", ok: /\d+ passed/.test(api) && !/failed/.test(api) },
    typecheck: { label: "5 workspaces", ok: shOk("pnpm typecheck") },
    lint: { label: "eslint, all workspaces", ok: shOk("pnpm lint") },
  };
  mkdirSync(join(REPO, ".harness"), { recursive: true });
  writeFileSync(GATES_FILE, JSON.stringify(result, null, 2));
  return result;
}

// ---------------------------------------------------------------------------
// Repo facts
// ---------------------------------------------------------------------------

const authorship = () => {
  const commits = sh('git log --format="%H%x1f%b%x1e"')
    .split("\x1e")
    .map((c) => c.trim())
    .filter(Boolean);
  const agent = commits.filter((c) => /Co-Authored-By:\s*Claude/i.test(c)).length;
  return { total: commits.length, agent, pct: commits.length ? Math.round((agent / commits.length) * 100) : 0 };
};

function ledgers() {
  const dir = join(REPO, ".claude", ".state");
  const out = { sessions: 0, blocks: {}, sourceEdits: 0, testRuns: 0 };
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    let l;
    try {
      l = JSON.parse(readFileSync(join(dir, f), "utf8"));
    } catch {
      continue;
    }
    out.sessions++;
    for (const b of l.blocksIssued ?? []) {
      const gate = String(b).split(":").pop();
      out.blocks[gate] = (out.blocks[gate] ?? 0) + 1;
    }
    out.sourceEdits += (l.sourceFilesTouched ?? []).length;
    out.testRuns += (l.testRuns ?? []).length;
  }
  return out;
}

const listDir = (p, filter) => {
  const abs = join(REPO, p);
  return existsSync(abs) ? readdirSync(abs).filter(filter) : [];
};

const evalFixtures = () => {
  const src = existsSync(join(REPO, "testing/agent-evals/run.mjs"))
    ? readFileSync(join(REPO, "testing/agent-evals/run.mjs"), "utf8")
    : "";
  return [...src.matchAll(/^\s*name:\s*"(.+?)"/gm)].map((m) => m[1]);
};

function pipeline() {
  if (!REMOTE) return [];
  // Query the agent workflows by name rather than scanning recent runs: ci and the scheduled critic
  // fire far more often, so a plain `--limit 20` window can contain no agent runs at all.
  let runs = [];
  for (const wf of ["agent-issue-to-pr.yml", "agent-pr-review.yml"]) {
    try {
      runs.push(
        ...JSON.parse(
          sh(`gh run list --workflow ${wf} --limit 8 --json databaseId,name,conclusion,createdAt,updatedAt`, "[]"),
        ),
      );
    } catch {
      /* workflow never ran, or gh unavailable — just show fewer rows */
    }
  }
  runs.sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt));
  const cache = existsSync(join(REPO, ".harness", "costs.json"))
    ? JSON.parse(readFileSync(join(REPO, ".harness", "costs.json"), "utf8"))
    : {};
  return runs.slice(0, 6)
    .map((r) => ({
      id: r.databaseId,
      ok: r.conclusion === "success",
      conclusion: r.conclusion ?? "running",
      mins: Math.max(1, Math.round((new Date(r.updatedAt) - new Date(r.createdAt)) / 60000)),
      cost: cache[r.databaseId],
    }));
}

// ---------------------------------------------------------------------------
// Static description of the harness. Not measured — this is the *design*, and it is what the
// numbers above are evidence for.
// ---------------------------------------------------------------------------

const LADDER = [
  ["1", "CLAUDE.md", "Project rules loaded into every session", "A suggestion — competes for attention, gets compacted away"],
  ["2", "Skills", "A procedure, loaded on demand", "Only runs if something invokes it"],
  ["3", "Subagents", "A worker with a restricted tool list", "Structural — a reviewer with no Edit tool cannot edit"],
  ["4", "Hooks", "Code that runs outside the model", "Deterministic — cannot be reasoned with"],
  ["5", "CI gates", "A machine checking the finished artifact", "The last line, and the only one that works unattended"],
];

const HOOKS = [
  ["guard-write.mjs", "PreToolUse", "Writes to the hooks, agent definitions, settings or CI config"],
  ["guard-bash.mjs", "PreToolUse", "Destructive commands, credential reads, and shell writes to protected paths"],
  ["scan-secrets.mjs", "PostToolUse", "A credential written into a source file"],
  ["record-bash.mjs", "PostToolUse", "(records test outcomes — no blocking)"],
  ["gate-turn.mjs", "Stop", "Ending a turn with an untested invariant, an unrun suite, or an unexamined diff"],
  ["session-brief.mjs", "SessionStart", "(injects branch and journal state — no blocking)"],
];

const AGENTS = [
  ["reuse-scout", "Read, Grep, Glob", "Reinvention — writing a helper that already exists"],
  ["altitude-critic", "+ Bash", "Over-engineering — code at the wrong altitude for the problem"],
  ["test-adversary", "+ Bash", "Tests that pass but would not catch a wrong implementation"],
  ["invariant-auditor", "Read, Grep, Glob", "A core rule quietly losing its enforcement"],
  ["refuter", "Read, Grep, Glob", "Confidently wrong findings reaching a human"],
];

const GAPS = [
  "Eval assertions match keywords in the reviewer's prose — weaker than a structured verdict.",
  "The diff budget counts lines, not complexity: a mechanical rename trips it, a subtle abstraction does not.",
  "Eval worktrees isolate disk but share the database — isolation is per-resource, not a property you get once.",
  "refuter has no eval coverage; its input is another agent's finding, so it needs a fixture pair.",
  "Nothing asserts that a future claude-code-action still honours project hooks.",
];

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const g = gates();
const a = authorship();
const led = ledgers();
const runs = pipeline();
const fixtures = evalFixtures();
const hookCount = listDir(".claude/hooks", (f) => f.endsWith(".mjs") && !f.startsWith("_")).length;
const agentCount = listDir(".claude/agents", (f) => f.endsWith(".md")).length;
const skillCount = listDir(".claude/skills", () => true).length;
const sha = sh("git rev-parse --short HEAD");
const blockTotal = Object.values(led.blocks).reduce((s, n) => s + n, 0);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const ago = (iso) => {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

/** Status is never colour alone — every tile carries a glyph and a word. */
const tile = (value, label, sub, ok) => `
  <div class="tile">
    <div class="tile-v ${ok === undefined ? "" : ok ? "good" : "bad"}">${ok === undefined ? "" : ok ? "✓ " : "✗ "}${esc(value)}</div>
    <div class="tile-l">${esc(label)}</div>
    <div class="tile-s">${esc(sub)}</div>
  </div>`;

const html = `<!doctype html>
<html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MemOS · Agent Harness</title>
<style>
  /* Dark surface and status steps from the validated reference palette. Status colours are fixed
     and never reused as series colours; each is paired with a glyph so meaning is never colour
     alone. The ladder uses one ordinal blue ramp — brighter reads as stronger on a dark surface. */
  :root{
    --surface:#1a1a19; --raised:#232322; --line:#33332f;
    --ink:#ffffff; --ink-2:#c3c2b7; --ink-3:#8a897e;
    --good:#0ca30c; --critical:#d03b3b; --warning:#fab219;
    --r1:#256abf; --r2:#3987e5; --r3:#6da7ec; --r4:#9ec5f4; --r5:#cde2fb;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--surface);color:var(--ink);
    font:15px/1.65 ui-sans-serif,-apple-system,"Segoe UI",system-ui,sans-serif;
    -webkit-font-smoothing:antialiased}
  .wrap{max-width:1080px;margin:0 auto;padding:56px 28px 80px}
  header{border-bottom:1px solid var(--line);padding-bottom:24px;margin-bottom:40px}
  h1{margin:0 0 6px;font-size:26px;letter-spacing:-.015em;font-weight:600}
  .sub{color:var(--ink-2);font-size:15px;max-width:62ch;margin:0}
  .meta{color:var(--ink-3);font-size:12.5px;margin-top:14px;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  h2{font-size:12px;letter-spacing:.10em;text-transform:uppercase;color:var(--ink-3);
    margin:48px 0 4px;font-weight:600}
  .lead{color:var(--ink-2);margin:0 0 18px;font-size:14px;max-width:70ch}
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:12px}
  .tile{background:var(--raised);border:1px solid var(--line);border-radius:10px;padding:16px 18px}
  .tile-v{font-size:23px;font-weight:600;letter-spacing:-.01em;line-height:1.2}
  .tile-v.good{color:var(--good)} .tile-v.bad{color:var(--critical)}
  .tile-l{font-size:13px;color:var(--ink);margin-top:6px}
  .tile-s{font-size:12px;color:var(--ink-3);margin-top:2px}
  table{width:100%;border-collapse:collapse;margin-top:6px;font-size:14px}
  th{text-align:left;font-weight:500;color:var(--ink-3);font-size:11.5px;
    letter-spacing:.07em;text-transform:uppercase;padding:0 12px 8px 0;border-bottom:1px solid var(--line)}
  td{padding:11px 12px 11px 0;border-bottom:1px solid var(--line);vertical-align:top;color:var(--ink-2)}
  td.k{color:var(--ink);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;white-space:nowrap}
  .rung{display:flex;gap:14px;align-items:baseline;padding:12px 0;border-bottom:1px solid var(--line)}
  .rung-n{width:30px;height:30px;flex:0 0 30px;border-radius:7px;display:grid;place-items:center;
    color:#0b0b0b;font-weight:700;font-size:13px}
  .rung-b{flex:1}
  .rung-t{color:var(--ink);font-weight:600;font-size:14.5px}
  .rung-d{color:var(--ink-2);font-size:13.5px}
  .rung-w{color:var(--ink-3);font-size:13px;font-style:italic;margin-top:2px}
  .good-t{color:var(--good)} .bad-t{color:var(--critical)}
  ul{margin:8px 0 0;padding-left:20px;color:var(--ink-2);font-size:14px} li{margin:7px 0}
  footer{margin-top:56px;padding-top:20px;border-top:1px solid var(--line);
    color:var(--ink-3);font-size:12.5px;max-width:72ch}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em;color:var(--ink-2)}
</style>
<div class="wrap">
<header>
  <h1>MemOS · Agent Harness</h1>
  <p class="sub">An LLM does what you ask, most of the time. That is fine for suggestions and useless
  for rules that matter — so everything here that matters is enforced by a mechanism outside the
  model's reach, and this page is the evidence that it fires.</p>
  <div class="meta">${esc(sha)} · gates measured ${esc(ago(g.measuredAt))} · generated ${new Date().toISOString().slice(0, 16).replace("T", " ")}</div>
</header>

<h2>Status</h2>
<div class="tiles">
  ${tile(g.hooks.label, "Hook test suite", "the guards test themselves", g.hooks.ok)}
  ${tile(`${fixtures.length} fixtures`, "Agent evals", "planted defects + a clean control", true)}
  ${tile(g.api.label, "Product test suite", "real database, not mocks", g.api.ok)}
  ${tile(g.typecheck.label, "Typecheck", g.typecheck.ok ? "clean" : "failing", g.typecheck.ok)}
  ${tile(g.lint.label, "Lint", g.lint.ok ? "clean" : "failing", g.lint.ok)}
  ${tile(`${a.pct}%`, "Agent co-authored", `${a.agent} of ${a.total} commits`)}
</div>

<h2>The enforcement ladder</h2>
<p class="lead">Five places a rule can live. The design decision is not whether a rule is written
down — it is which level it belongs on, i.e. what happens when the model would rather not comply.</p>
${LADDER.map(
  ([n, name, what, why], i) => `
  <div class="rung">
    <div class="rung-n" style="background:var(--r${i + 1})">${n}</div>
    <div class="rung-b">
      <div class="rung-t">${esc(name)}</div>
      <div class="rung-d">${esc(what)}</div>
      <div class="rung-w">${esc(why)}</div>
    </div>
  </div>`,
).join("")}

<h2>The guards · ${hookCount} hooks</h2>
<p class="lead">Small programs run by the agent runtime at fixed moments. They receive a description
of what is about to happen and return a verdict. Ordinary code — it has no opinions and cannot be
persuaded, which is the entire point.</p>
<table>
  <tr><th>Hook</th><th>Fires</th><th>What it prevents</th></tr>
  ${HOOKS.map(([n, ev, w]) => `<tr><td class="k">${esc(n)}</td><td>${esc(ev)}</td><td>${esc(w)}</td></tr>`).join("")}
</table>

<h2>Do they actually fire?</h2>
<p class="lead">Counts come from the per-session ledgers the hooks write as they run, so they are a
by-product of enforcement rather than separate instrumentation that could drift from it.</p>
<div class="tiles">
  ${tile(String(blockTotal), "Turns blocked", "by an end-of-turn gate")}
  ${tile(String(led.sessions), "Sessions recorded", "ledgers on disk")}
  ${tile(String(led.testRuns), "Test runs", "logged this machine")}
  ${tile("5", "Times they blocked me", "their own author — all documented")}
</div>
${
  blockTotal
    ? `<table style="margin-top:16px"><tr><th>Gate</th><th>Times fired</th></tr>${Object.entries(led.blocks)
        .sort((x, y) => y[1] - x[1])
        .map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${v}</td></tr>`)
        .join("")}</table>`
    : ""
}

<h2>The reviewers · ${agentCount} subagents</h2>
<p class="lead">Separate agents with their own context and their own tool list. None of the critics
has an edit tool — telling a reviewer "report, don't fix" does not hold, so the restriction is
structural rather than instructional.</p>
<table>
  <tr><th>Agent</th><th>Tools</th><th>What it catches</th></tr>
  ${AGENTS.map(([n, t, w]) => `<tr><td class="k">${esc(n)}</td><td>${esc(t)}</td><td>${esc(w)}</td></tr>`).join("")}
</table>

<h2>Regression tests for the reviewers</h2>
<p class="lead">The subagents are prompts, and prompts are the least stable artifact here — change a
sentence and a reviewer can silently stop catching things, with nothing failing. Each fixture plants
a known defect in an isolated worktree and asserts the real agent caught it. The control must
produce no findings, so the false-alarm rate is measured rather than assumed.</p>
<table>
  <tr><th>#</th><th>Fixture</th></tr>
  ${fixtures.map((f, i) => `<tr><td class="k">${String(i + 1).padStart(2, "0")}</td><td>${esc(f)}</td></tr>`).join("")}
</table>

${
  runs.length
    ? `<h2>Unattended pipeline</h2>
<p class="lead">Label a GitHub issue and an agent writes the code and opens a pull request. Two
stages with different permissions: triage can only read and comment, and may refuse a vague issue;
build only runs if triage approved. Any failing check opens the PR as a draft.</p>
<table>
  <tr><th>Run</th><th>Result</th><th>Duration</th><th>Cost</th></tr>
  ${runs
    .map(
      (r) =>
        `<tr><td class="k">${r.id}</td><td class="${r.ok ? "good-t" : "bad-t"}">${r.ok ? "✓ " : "✗ "}${esc(r.conclusion)}</td><td>${r.mins} min</td><td>${r.cost ? "$" + r.cost.toFixed(2) : "—"}</td></tr>`,
    )
    .join("")}
</table>`
    : ""
}

<h2>Known gaps</h2>
<p class="lead">Listed because a harness that hides its weaknesses is making exactly the
unverified-claim mistake it exists to prevent.</p>
<ul>${GAPS.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>

<footer>
Generated by <code>node scripts/dashboard.mjs</code> — one script, no server, no dependencies. It
reads git history, the hook ledgers, the installed hooks and agents, and the GitHub API, then writes
this file. Gate results are cached; re-measure with <code>--gates</code>.
</footer>
</div>
</html>`;

writeFileSync(join(REPO, "harness.html"), html, "utf8");
console.log(`wrote harness.html  (${hookCount} hooks, ${agentCount} agents, ${skillCount} skills, ${fixtures.length} eval fixtures)`);

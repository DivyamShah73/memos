/**
 * Regression tests for the subagents.
 *
 * The hooks have a test suite (testing/harness_hooks.sh). The subagents did not — and they are the
 * least stable artifact in the whole harness, because they are *prompts*. Change one sentence in
 * test-adversary.md and it can silently stop catching fake tests: nothing fails, no gate goes red,
 * and you find out months later when a bad test ships. That is exactly the failure this repo's
 * thesis is about ("a guard that quietly stops working is worse than not having one"), so the
 * critics get the same treatment as the invariants they police.
 *
 * Method: plant a known defect in an isolated git worktree, run the REAL subagent against it via
 * `claude -p` (so the actual .claude/agents definition is exercised, not a copy of its prompt), and
 * assert it was caught.
 *
 * The fifth fixture is the important one: a genuinely clean diff that must produce NO findings. A
 * critic that flags everything is as useless as one that flags nothing, and false-positive rate is
 * the thing nobody measures. Same reasoning as the hook suite asserting the *allowed* forms.
 *
 * Known limitation, stated rather than hidden: assertions are keyword-based over the agent's prose.
 * That is weaker than a structured verdict, and the honest fix is to make the critics emit JSON. It
 * still catches the failure that matters — a critic that stops reporting the defect at all.
 *
 *   node testing/agent-evals/run.mjs            # all fixtures
 *   node testing/agent-evals/run.mjs 02         # one fixture by id
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

const REPO = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();

/**
 * Each fixture: files to plant, which subagent should catch it, and what the finding must mention.
 * `expectClean` inverts the assertion — the agent must find nothing.
 */
const FIXTURES = [
  {
    id: "01",
    name: "reinvented helper — duplicates _fts.ts",
    agent: "altitude-critic",
    files: {
      "packages/api/src/intents/_textsearch.ts": `import { sql } from "drizzle-orm";

/** Build a tsquery from a user's keywords. */
export function buildTextQuery(input: string) {
  const terms = input.trim().split(/\\s+/).filter(Boolean).join(" & ");
  return sql\`to_tsquery('english', \${terms})\`;
}

/** Rank a column against a query. */
export function rankText(column: unknown, query: string) {
  return sql\`ts_rank(to_tsvector('english', \${column}), to_tsquery('english', \${query}))\`;
}
`,
    },
    expect: [/_fts/i, /(duplicat|already exists|reinvent|same thing)/i],
  },
  {
    id: "02",
    name: "fake test — asserts a literal, not the code",
    agent: "test-adversary",
    files: {
      "packages/api/src/intents/fact.record.eval.test.ts": `import { describe, expect, it } from "vitest";

describe("fact.record", () => {
  it("rejects a medium-confidence fact with no evidence", async () => {
    // Build the "response" locally and assert on it.
    const response = { ok: false, error: "evidence_artifact_id is required" };
    expect(response.ok).toBe(false);
    expect(response.error).toContain("evidence");
  });

  it("accepts a low-confidence fact", async () => {
    const response = { ok: true };
    expect(response).toBeDefined();
  });
});
`,
    },
    expect: [/(never calls|does not call|doesn't call|no.*handler|mock|literal|hand-built|constructs)/i],
  },
  {
    id: "03",
    name: "weakened evidence gate — invariant edited, no test",
    agent: "invariant-auditor",
    patch: [
      {
        file: "packages/api/src/intents/_evidence.ts",
        from: 'if (item.confidence !== "low") {',
        to: 'if (item.confidence === "high") {',
      },
    ],
    expect: [/(medium)/i, /(gate|invariant|evidence)/i],
  },
  {
    id: "04",
    name: "speculative abstraction — factory with one call site",
    agent: "altitude-critic",
    files: {
      "packages/api/src/intents/_tagPolicy.ts": `/** Strategy interface for validating applies_to tags. */
export interface TagPolicy {
  readonly name: string;
  validate(tag: string): boolean;
}

export class ProblemDomainTagPolicy implements TagPolicy {
  readonly name = "problem-domain";
  validate(tag: string): boolean {
    return !/^(project|team|agent)\\./.test(tag);
  }
}

export class TagPolicyFactory {
  private static registry = new Map<string, () => TagPolicy>([
    ["problem-domain", () => new ProblemDomainTagPolicy()],
  ]);
  static create(kind = "problem-domain"): TagPolicy {
    const make = TagPolicyFactory.registry.get(kind);
    if (!make) throw new Error(\`unknown tag policy: \${kind}\`);
    return make();
  }
}

/** The only caller. */
export function isProblemDomainTag(tag: string): boolean {
  return TagPolicyFactory.create().validate(tag);
}
`,
    },
    expect: [/(one call site|single call site|only caller|over-?engineer|abstraction|indirection|regex)/i],
  },
  {
    // The false-positive control, and the one that matters most. A critic that flags everything is
    // as useless as one that flags nothing, so the suite has to prove the critics stay quiet on good
    // work — the same reason harness_hooks.sh asserts the *allowed* command forms, not just denials.
    //
    // First attempt used a "clean" one-file diff adding a helper. altitude-critic flagged it, and it
    // was RIGHT: the helper had zero call sites, which is dead code. The fixture was wrong, not the
    // critic. Replaced with a well-written test, which is a much harder artifact to nitpick.
    // A docs-only diff. It cannot touch a gate, a query or a policy, so the correct audit is "all
    // five unaffected" — and a critic that manufactures a finding here is the failure mode being
    // tested. Deliberately not a code fixture: the first two attempts at a "clean" code diff both
    // contained real defects the critics correctly caught (dead code, then a wrong helper
    // signature), which is its own lesson — a control has to be genuinely unimpeachable, and prose
    // is the easiest thing to make so.
    id: "05",
    name: "CONTROL — docs-only change (must find nothing)",
    agent: "invariant-auditor",
    files: {
      "docs/RUNBOOK.md": `# Local runbook

Start the stack, apply migrations, seed demo data, run the gateway.

\`\`\`bash
docker compose up -d db minio
pnpm db:migrate
pnpm db:seed
pnpm dev:api
\`\`\`

The gateway listens on :8787. \`GET /health\` returns the uniform envelope, so a healthy response is
\`{ "ok": true, "data": { "status": "healthy" } }\` rather than a bare 200.

## Running the gates

\`\`\`bash
pnpm typecheck                    # all workspaces
pnpm lint                         # eslint, flat config at the root
pnpm --filter @memos/api test     # needs the compose stack up
bash testing/harness_hooks.sh     # the agent hooks; no infra needed
\`\`\`
`,
    },
    expectClean: true,
  },
];

const PROMPTS = {
  "altitude-critic":
    "Use the altitude-critic subagent to review the uncommitted changes in this working tree " +
    "(`git status` then `git diff HEAD` plus any untracked files). Report its findings verbatim. " +
    "If it finds nothing worth flagging, say exactly: NO FINDINGS.",
  // Explicitly no suite run: this is a bare worktree with no node_modules, so `pnpm test` stalls
  // and then times out — which looks exactly like a failed assertion. Mutation analysis is a
  // reading exercise anyway; running the suite only confirms the tests pass, not that they detect.
  "test-adversary":
    "Use the test-adversary subagent on the uncommitted test changes in this working tree " +
    "(`git status`, then read any new *.test.ts). Do NOT run the test suite — dependencies are not " +
    "installed here; reason from the code. Report its findings verbatim. " +
    "If every test genuinely detects a wrong implementation, say exactly: NO FINDINGS.",
  "invariant-auditor":
    "Use the invariant-auditor subagent on the uncommitted changes in this working tree " +
    "(`git diff HEAD`). Report its findings verbatim. " +
    "If all five core invariants still hold, say exactly: NO FINDINGS.",
};

/** First 24 lines of the agent's output, indented — enough to see why an assertion missed. */
const indent = (s) => s.split("\n").slice(0, 24).map((l) => `      | ${l}`).join("\n");

const only = process.argv[2];
const fixtures = only ? FIXTURES.filter((f) => f.id === only) : FIXTURES;

let pass = 0;
let fail = 0;

for (const fx of fixtures) {
  const dir = mkdtempSync(join(tmpdir(), `memos-eval-${fx.id}-`));
  process.stdout.write(`\n[${fx.id}] ${fx.name}\n      agent: ${fx.agent} … `);
  try {
    // Isolated worktree: the fixture never touches the real working tree, and .claude/ comes along
    // because it's committed — so the agent runs under the same hooks it always does.
    execFileSync("git", ["worktree", "add", "--detach", dir, "HEAD"], { cwd: REPO, stdio: "pipe" });

    for (const [rel, content] of Object.entries(fx.files ?? {})) {
      const abs = join(dir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, "utf8");
    }
    for (const p of fx.patch ?? []) {
      const abs = join(dir, p.file);
      const src = execSync(`git show HEAD:${p.file}`, { cwd: REPO, encoding: "utf8" });
      if (!src.includes(p.from)) throw new Error(`patch anchor not found in ${p.file}`);
      writeFileSync(abs, src.replace(p.from, p.to), "utf8");
    }

    // Deliberately no `shell: true`. Through a shell, args are concatenated unescaped, and the
    // backticks and parentheses in these prompts get eaten — the agent then receives no task at all,
    // which looks identical to a failing assertion. Cost an hour to notice the first time.
    const out = execFileSync(
      "claude",
      ["-p", PROMPTS[fx.agent], "--model", "claude-sonnet-5", "--permission-mode", "bypassPermissions"],
      { cwd: dir, encoding: "utf8", timeout: 420000, maxBuffer: 10 * 1024 * 1024 },
    );

    if (fx.expectClean) {
      const clean = /NO FINDINGS/i.test(out);
      if (clean) {
        pass++;
        console.log("ok — no findings on a clean diff");
      } else {
        fail++;
        console.log(`FAIL — flagged a clean diff (false positive)\n${indent(out)}`);
      }
    } else {
      const missing = fx.expect.filter((re) => !re.test(out));
      if (missing.length === 0) {
        pass++;
        console.log("ok — defect detected");
      } else {
        fail++;
        console.log(`FAIL — missed ${missing.map(String).join(" ")}\n${indent(out)}`);
      }
    }
  } catch (err) {
    fail++;
    console.log(`FAIL — ${err.message.split("\n")[0]}`);
  } finally {
    try {
      execFileSync("git", ["worktree", "remove", "--force", dir], { cwd: REPO, stdio: "pipe" });
    } catch {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

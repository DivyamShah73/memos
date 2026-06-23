/**
 * Phase 12 / ADR-010 — the authorization matrix. Pure unit tests over `authorize`, plus an
 * end-to-end check that the dispatch guard actually denies (403) before the handler runs:
 * member cannot steer, manager can, CEO is read-only (writes denied, reads allowed).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authorize } from "./authz.js";
import { queryClient } from "../db/index.js";
import { gatewayClient } from "../db/gateway.js";
import { call, seedBase, seedProject, enrollAgent, cleanupAndClose } from "../_testutil.js";

describe("authorize() — the role→capability matrix", () => {
  it("member: contributes but cannot steer", () => {
    expect(authorize("fact.record", "member").allowed).toBe(true);
    expect(authorize("learning.query", "member").allowed).toBe(true);
    expect(authorize("objective.publish", "member").allowed).toBe(false);
    expect(authorize("brief.create", "member").allowed).toBe(false);
  });
  it("manager: contributes AND steers", () => {
    expect(authorize("fact.record", "manager").allowed).toBe(true);
    expect(authorize("objective.publish", "manager").allowed).toBe(true);
    expect(authorize("brief.create", "manager").allowed).toBe(true);
    expect(authorize("question.answer", "manager").allowed).toBe(true);
  });
  it("ceo: read-only — every write denied, every read allowed", () => {
    expect(authorize("fact.record", "ceo").allowed).toBe(false); // contribute write
    expect(authorize("objective.publish", "ceo").allowed).toBe(false); // steer write
    expect(authorize("brief.ack", "ceo").allowed).toBe(false); // even a small write
    expect(authorize("fact.query", "ceo").allowed).toBe(true);
    expect(authorize("objective.query", "ceo").allowed).toBe(true);
    expect(authorize("provenance.trace", "ceo").allowed).toBe(true);
  });
});

const P = "project.authz-test";

describe("authz guard enforced through dispatch (403 before handler)", () => {
  let member: string, manager: string, ceo: string;

  beforeAll(async () => {
    await seedBase();
    await seedProject(P, false);
    // Names MUST start with "vitest-" so cleanupAndClose removes them before deleting the team.
    member = await enrollAgent([P], "vitest-authz-member", "member");
    manager = await enrollAgent([P], "vitest-authz-manager", "manager");
    ceo = await enrollAgent([P], "vitest-authz-ceo", "ceo");
  });
  afterAll(async () => {
    await cleanupAndClose([P]);
    await Promise.all([queryClient.end({ timeout: 5 }), gatewayClient.end({ timeout: 5 })]);
  });

  const brief = { project_id: P, title: "t", body: "b", target_kind: "project", target_id: P };

  it("member is 403 on a steering intent", async () => {
    const { status } = await call("brief.create", member, brief);
    expect(status).toBe(403);
  });
  it("manager passes the guard on a steering intent (not 403)", async () => {
    const { status } = await call("brief.create", manager, brief);
    expect(status).not.toBe(403);
  });
  it("ceo is 403 on any write (read-only)", async () => {
    const { status } = await call("fact.record", ceo, {
      project_id: P,
      bd_id: "memos-nope",
      facts: [{ claim: "x", confidence: "low" }],
    });
    expect(status).toBe(403);
  });
  it("ceo is allowed on reads (not 403)", async () => {
    const { status } = await call("learning.query", ceo, { project_id: P, query: "anything" });
    expect(status).not.toBe(403);
  });
});

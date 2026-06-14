import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  call,
  cleanupAndClose,
  enrollAgent,
  ownerDb,
  seedBase,
  seedProject,
  seedWorkflowRun,
} from "../_testutil.js";
import { getObject } from "../services/blobstore.js";

const P = "project.vitest-art";
let token: string;
let bd: string;

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

beforeAll(async () => {
  await seedBase();
  await seedProject(P, false);
  token = await enrollAgent([P], "vitest-art");
  bd = await seedWorkflowRun(P);
});

afterAll(async () => {
  await cleanupAndClose([P]);
});

describe("artifact.upload", () => {
  it("uploads bytes and returns metadata + sha256", async () => {
    const content = "evidence body: run 022 hit 92.6% pass rate";
    const { status, json } = await call("artifact.upload", token, {
      project_id: P,
      bd_id: bd,
      kind: "log",
      description: "smoke",
      mime_type: "text/plain",
      content_base64: b64(content),
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.artifact_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(json.data.bucket_path).toBe(`${P}/${json.data.artifact_id}`);
    expect(json.data.size_bytes).toBe(Buffer.byteLength(content));
    expect(json.data.sha256).toBe(createHash("sha256").update(content).digest("hex"));
  });

  it("stores the bytes in MinIO, not Postgres (sha256 roundtrip + no bytea column)", async () => {
    const content = "roundtrip-" + "x".repeat(200);
    const { json } = await call("artifact.upload", token, {
      project_id: P,
      bd_id: bd,
      kind: "log",
      mime_type: "application/octet-stream",
      content_base64: b64(content),
    });

    // The blob really lives in MinIO and hashes to the returned sha256.
    const body = await getObject(json.data.bucket_path);
    expect(createHash("sha256").update(body).digest("hex")).toBe(json.data.sha256);
    expect(body.toString("utf8")).toBe(content);

    // The artifacts table holds only metadata — no bytea/content column.
    const rows = (await ownerDb.execute(
      sql`select column_name, data_type from information_schema.columns where table_schema='public' and table_name='artifacts'`,
    )) as unknown as { column_name: string; data_type: string }[];
    expect(rows.some((r) => r.data_type === "bytea")).toBe(false);
    expect(rows.map((r) => r.column_name).sort()).toEqual(
      [
        "bd_id",
        "bucket_path",
        "created_at",
        "description",
        "id",
        "kind",
        "mime_type",
        "project_id",
        "sha256",
        "size_bytes",
      ].sort(),
    );
  });

  it("rejects an upload to an unknown workflow run", async () => {
    const { json } = await call("artifact.upload", token, {
      project_id: P,
      bd_id: "memos-deadbeef",
      kind: "log",
      mime_type: "text/plain",
      content_base64: b64("x"),
    });
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/unknown workflow run/);
  });
});

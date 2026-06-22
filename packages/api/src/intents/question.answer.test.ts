import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  cleanupAndClose,
  enrollAgent,
  seedBase,
  seedProject,
} from "../_testutil.js";

const A = "project.vitest-qans";
let token: string;

beforeAll(async () => {
  await seedBase();
  await seedProject(A, false);
  token = await enrollAgent([A], "vitest-qans");
});

afterAll(async () => {
  await cleanupAndClose([A]);
});

describe("question.answer", () => {
  it("answers a question and delivers the answer to the asker as a brief", async () => {
    const ask = await call("question.ask", token, {
      project_id: A,
      subject: "scaling",
      body: "how many replicas?",
    });
    const questionId = ask.json.data.question_id;

    const answer = await call("question.answer", token, {
      project_id: A,
      question_id: questionId,
      answer: "start with three replicas",
    });
    expect(answer.json.ok).toBe(true);
    expect(answer.json.data.brief_id).toBeDefined();

    // The answer surfaces to the asker as a brief.
    const fetch = await call("brief.fetch", token, { project_id: A });
    const match = fetch.json.data.briefs.find((b: any) => b.id === answer.json.data.brief_id);
    expect(match).toBeDefined();
    expect(match.title).toMatch(/scaling/);
    expect(match.body).toMatch(/three replicas/);
    expect(match.target_kind).toBe("agent");
  });

  it("rejects answering an already-answered question (ok:false)", async () => {
    const ask = await call("question.ask", token, { project_id: A, body: "once?" });
    const qid = ask.json.data.question_id;
    await call("question.answer", token, { project_id: A, question_id: qid, answer: "yes" });
    const again = await call("question.answer", token, { project_id: A, question_id: qid, answer: "no" });
    expect(again.json.ok).toBe(false);
    expect(again.json.error).toMatch(/already answered/);
  });

  it("rejects a question not in this project (ok:false)", async () => {
    const { json } = await call("question.answer", token, {
      project_id: A,
      question_id: "00000000-0000-0000-0000-000000000000",
      answer: "x",
    });
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/not found in this project/);
  });
});

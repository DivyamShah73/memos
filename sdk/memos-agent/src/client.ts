/**
 * MemOS agent client. A thin, typed wrapper over the intent-RPC gateway: every method posts to
 * `POST /v1/intent/{name}` with the agent's bearer token, parses the uniform envelope, returns
 * `data` on success, and throws a {@link MemosError} on `ok:false` — so callers use try/catch
 * instead of inspecting flags. Input shapes are the project's Zod-inferred types (@memos/shared).
 */
import type { z } from "zod";
import type {
  ArtifactUploadInput,
  BriefAckInput,
  BriefCreateInput,
  CheckinInput,
  FactRecordInput,
  KeyResultUpdateInput,
  LearningRecordInput,
  MilestoneAchieveInput,
  ObjectivePublishInput,
  ObjectiveUpdateInput,
  ProvenanceTraceInput,
  QuestionAnswerInput,
  QuestionAskInput,
  WorkflowCreateInput,
} from "@memos/shared";
// Schemas (not just types) for the intents with defaulted fields — the SDK takes the *input*
// type (`z.input`, where defaults are optional), not the parsed output type the handlers receive.
import {
  activityRecentInputSchema,
  briefFetchInputSchema,
  factQueryInputSchema,
  learningListInputSchema,
  learningQueryInputSchema,
  objectiveQueryInputSchema,
} from "@memos/shared";

/** Thrown when the gateway returns `{ ok: false }`. Carries the machine-readable error_type. */
export class MemosError extends Error {
  constructor(
    message: string,
    readonly errorType: string,
    readonly detail?: unknown,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MemosError";
  }
}

export interface EnrollResult {
  client: MemosClient;
  agentId: string;
  token: string;
  scopes: string[];
}

async function rawCall<T>(
  apiUrl: string,
  token: string | null,
  intent: string,
  body: Record<string, unknown>,
): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${apiUrl}/v1/intent/${intent}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: { ok: boolean; data?: T; error?: string; error_type?: string; detail?: unknown };
  try {
    json = JSON.parse(text);
  } catch {
    // A non-JSON response (proxy 5xx, dead process, empty body) — surface it as a MemosError, not
    // a raw SyntaxError, so callers' try/catch keeps working uniformly.
    throw new MemosError(`non-JSON response from ${intent}`, "platform_error", text.slice(0, 200), res.status);
  }
  if (!json.ok) {
    throw new MemosError(
      json.error ?? `intent ${intent} failed`,
      json.error_type ?? "platform_error",
      json.detail,
      res.status,
    );
  }
  return json.data as T;
}

export class MemosClient {
  constructor(
    readonly apiUrl: string,
    readonly token: string,
  ) {}

  /** Exchange a single-use enrollment code for a permanent token and a ready client. */
  static async enroll(apiUrl: string, code: string, displayName: string): Promise<EnrollResult> {
    const data = await rawCall<{ agent_id: string; api_token: { raw: string }; scopes: string[] }>(
      apiUrl,
      null,
      "agent.enroll",
      { code, display_name: displayName },
    );
    return {
      client: new MemosClient(apiUrl, data.api_token.raw),
      agentId: data.agent_id,
      token: data.api_token.raw,
      scopes: data.scopes,
    };
  }

  /** Escape hatch: call any intent by name (typed methods below cover the common ones). */
  call<T = unknown>(intent: string, body: Record<string, unknown> = {}): Promise<T> {
    return rawCall<T>(this.apiUrl, this.token, intent, body);
  }

  // --- workflow / provenance spine ---
  workflowCreate(input: WorkflowCreateInput) {
    return this.call<{ bd_id: string }>("workflow.create", input);
  }
  checkin(input: CheckinInput) {
    return this.call<{ checkin_id: string }>("checkin", input);
  }
  artifactUpload(input: ArtifactUploadInput) {
    return this.call<{ artifact_id: string; bucket_path: string; size_bytes: number; sha256: string }>(
      "artifact.upload",
      input,
    );
  }

  // --- knowledge (evidence-gated) ---
  factRecord(input: FactRecordInput) {
    return this.call<{ fact_ids: string[] }>("fact.record", input);
  }
  learningRecord(input: LearningRecordInput) {
    return this.call<{ learning_ids: string[] }>("learning.record", input);
  }
  factQuery(input: z.input<typeof factQueryInputSchema>) {
    return this.call<{ facts: Array<Record<string, unknown>> }>("fact.query", input);
  }
  learningQuery(input: z.input<typeof learningQueryInputSchema>) {
    return this.call<{ learnings: Array<Record<string, unknown>> }>("learning.query", input);
  }
  learningList(input: z.input<typeof learningListInputSchema>) {
    return this.call<{ learnings: Array<Record<string, unknown>> }>("learning.list", input);
  }
  provenanceTrace(input: ProvenanceTraceInput) {
    return this.call<{ nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> }>(
      "provenance.trace",
      input,
    );
  }

  // --- OKRs ---
  objectivePublish(input: ObjectivePublishInput) {
    return this.call<{ objective_id: string; milestone_ids: string[] }>("objective.publish", input);
  }
  objectiveQuery(input: z.input<typeof objectiveQueryInputSchema>) {
    return this.call<{ objectives: Array<Record<string, unknown>> }>("objective.query", input);
  }
  objectiveUpdate(input: ObjectiveUpdateInput) {
    return this.call<{ objective_id: string; status: string }>("objective.update", input);
  }
  milestoneAchieve(input: MilestoneAchieveInput) {
    return this.call<{ milestone_id: string; status: string; objective_progress: number | null }>(
      "milestone.achieve",
      input,
    );
  }
  keyResultUpdate(input: KeyResultUpdateInput) {
    return this.call<{ milestone_id: string; progress: number; objective_progress: number | null }>(
      "key_result.update",
      input,
    );
  }

  // --- steering ---
  briefFetch(input: z.input<typeof briefFetchInputSchema>) {
    return this.call<{ briefs: Array<Record<string, unknown>>; active_okrs: Array<Record<string, unknown>> }>(
      "brief.fetch",
      input,
    );
  }
  briefAck(input: BriefAckInput) {
    return this.call<{ brief_id: string; acked: boolean }>("brief.ack", input);
  }
  briefCreate(input: BriefCreateInput) {
    return this.call<{ brief_id: string }>("brief.create", input);
  }
  questionAsk(input: QuestionAskInput) {
    return this.call<{ question_id: string }>("question.ask", input);
  }
  questionAnswer(input: QuestionAnswerInput) {
    return this.call<{ question_id: string; brief_id: string }>("question.answer", input);
  }

  // --- introspection ---
  agentMe() {
    return this.call<{ agent_id: string; scopes: string[]; team_id: string | null; org_id: string | null }>(
      "agent.me",
    );
  }
  activityRecent(input: z.input<typeof activityRecentInputSchema>) {
    return this.call<{ activity: Array<Record<string, unknown>> }>("activity.recent", input);
  }
}

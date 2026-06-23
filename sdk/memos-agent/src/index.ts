// @memos/agent — typed client for the MemOS intent-RPC gateway.
//   import { MemosClient } from "@memos/agent";
//   const { client } = await MemosClient.enroll(API_URL, code, "my-agent");
//   const { bd_id } = await client.workflowCreate({ project_id, workflow_class, title });
export { MemosClient, MemosError, type EnrollResult } from "./client.js";

/**
 * Loads the repo-root .env regardless of the process cwd.
 *
 * `pnpm db:migrate` / `db:seed` / `dev` all run with cwd = packages/api, but the single
 * source-of-truth .env lives at the repo root. dotenv's default cwd lookup would miss it,
 * so we resolve the root explicitly from this module's location. Import for side effect:
 *   import "../env.js";
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config as loadEnv } from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/api/src -> ../.. = repo root is two up from src? No: src -> .. = packages/api,
// packages/api -> ../.. = repo root. So from src: ../../.. = repo root.
export const repoRoot = path.resolve(here, "../../..");

loadEnv({ path: path.join(repoRoot, ".env") });

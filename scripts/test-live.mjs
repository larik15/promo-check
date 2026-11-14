// Runs test/live.test.ts against the real API.
// Reads ANTHROPIC_API_KEY from the environment or from a local .env file (git-ignored).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

if (existsSync(".env") && typeof process.loadEnvFile === "function") process.loadEnvFile(".env");
if (!process.env.ANTHROPIC_API_KEY) console.log("ANTHROPIC_API_KEY is not set: the live test will be skipped.");
const r = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run"], {
  stdio: "inherit",
  env: { ...process.env, PROMO_CHECK_LIVE: "1" },
});
process.exit(r.status ?? 1);

/**
 * Global test setup: point the DB client at a unique temp file per worker
 * and run migrations before any test imports touch the database.
 *
 * Must run before any `src/db/client.ts` import — vitest.config.ts
 * registers this file as a setupFile so it's guaranteed to execute first.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

const workerId = process.env.VITEST_POOL_ID ?? "0";
const tmpDir = mkdtempSync(join(tmpdir(), `thinking-tools-test-${workerId}-`));
const dbPath = join(tmpDir, "test.db");
process.env.DB_PATH = dbPath;

// Apply the drizzle migrations to the fresh DB before tests start.
// Using execSync keeps this independent of the in-process DB client,
// which imports the env var at module load.
execSync("npx tsx src/db/migrate.ts", {
  stdio: "inherit",
  env: { ...process.env, DB_PATH: dbPath },
});

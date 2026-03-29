import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const dbPath =
  process.env.DB_PATH || path.join(os.homedir(), ".thinking-tools", "thinking.db");

// Auto-create the parent directory if it doesn't exist
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const config = {
  dbPath,
} as const;

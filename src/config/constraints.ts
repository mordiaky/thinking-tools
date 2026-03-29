import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ConstraintsConfig {
  softwareOnly: {
    description: string;
    rejectionCriteria: string[];
    examples: {
      allowed: string[];
      rejected: string[];
    };
  };
}

const constraintsPath = resolve(__dirname, "../../config/constraints.json");

export const constraintsConfig: ConstraintsConfig = JSON.parse(
  readFileSync(constraintsPath, "utf-8"),
);

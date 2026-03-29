import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface RubricConfig {
  weights: {
    novelty: number;
    usefulness: number;
    feasibility: number;
    testability: number;
    speedToMvp: number;
    defensibility: number;
  };
  thresholds: {
    feasibility: number;
    usefulness: number;
    novelty: number;
    composite: number;
  };
  clarityGate: {
    minimumScore: number;
    includedInComposite: boolean;
  };
  anchors: Record<string, Record<string, string>>;
}

const rubricPath = resolve(__dirname, "../../config/rubric.json");

export const rubricConfig: RubricConfig = JSON.parse(
  readFileSync(rubricPath, "utf-8"),
);

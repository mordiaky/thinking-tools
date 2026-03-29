import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface Technique {
  id: string;
  name: string;
  description: string;
  promptTemplate: string;
  requiredOutputFields: string[];
}

export interface TechniqueConfig {
  techniques: Technique[];
}

const techniquesPath = resolve(__dirname, "../../config/techniques.json");

export const techniquesConfig: TechniqueConfig = JSON.parse(
  readFileSync(techniquesPath, "utf-8"),
);

export function selectTechniques(
  candidateCount: number,
  forcedTechniqueId?: string,
): Technique[] {
  const techniques = techniquesConfig.techniques;

  if (forcedTechniqueId !== undefined) {
    const found = techniques.find((t) => t.id === forcedTechniqueId);
    if (!found) {
      throw new Error(
        `Unknown technique id: "${forcedTechniqueId}". Valid ids: ${techniques.map((t) => t.id).join(", ")}`,
      );
    }
    return Array.from({ length: candidateCount }, () => found);
  }

  // Rotate through techniques; cycles back from start if candidateCount > techniques.length
  return Array.from(
    { length: candidateCount },
    (_, i) => techniques[i % techniques.length],
  );
}

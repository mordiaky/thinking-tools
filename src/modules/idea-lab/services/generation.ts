import { db } from "../../../db/client.js";
import { ideaRuns } from "../../../db/schema.js";
import {
  techniquesConfig,
  selectTechniques,
  Technique,
} from "../../../config/techniques.js";
import { constraintsConfig } from "../../../config/constraints.js";
import { getTopPatterns } from "./rejection-patterns.js";
import { getUnderrepresentedDomains } from "./portfolio.js";

export interface GenerateIdeasInput {
  domain?: string;
  problemArea?: string;
  candidateCount?: number;
  forcedTechnique?: string;
  diversify?: boolean;
}

export interface CandidateInstruction {
  index: number;
  technique: Technique;
  prompt: string;
  requiredFields: string[];
}

export interface GenerateIdeasResult {
  runId: string;
  candidateCount: number;
  instructions: CandidateInstruction[];
  pipelineSteps: string;
  softwareOnlyReminder: string;
  antiPatterns: string;
  diversifyGuidance: string;
}

/**
 * Substitutes template placeholders in a technique promptTemplate string.
 *
 * Placeholders supported:
 *   {{count}}            — replaced with the count string
 *   {{domain}}           — replaced with the domain string
 *   {{#problemArea}}...{{problemArea}}...{{/problemArea}}
 *                        — if problemArea provided, inner content is kept (with {{problemArea}} replaced);
 *                          if not provided, the entire block is removed
 */
function substituteTemplate(
  template: string,
  count: string,
  domain: string,
  problemArea?: string,
): string {
  // Handle conditional problemArea block
  const problemAreaPattern =
    /\{\{#problemArea\}\}([\s\S]*?)\{\{\/problemArea\}\}/g;
  let result = template.replace(problemAreaPattern, (_match, inner: string) => {
    if (problemArea) {
      return inner.replace(/\{\{problemArea\}\}/g, problemArea);
    }
    return "";
  });

  result = result.replace(/\{\{count\}\}/g, count);
  result = result.replace(/\{\{domain\}\}/g, domain);

  return result;
}

export async function generateIdeas(
  input: GenerateIdeasInput,
): Promise<GenerateIdeasResult> {
  // Validate and clamp candidateCount to 5-8 range per GEN-01
  const rawCount = input.candidateCount ?? 5;
  const candidateCount = Math.max(5, Math.min(8, rawCount));

  const domain = input.domain ?? "general software";

  // Select techniques via rotation or forced override
  const techniques = selectTechniques(candidateCount, input.forcedTechnique);

  // Build per-candidate instructions
  const instructions: CandidateInstruction[] = techniques.map(
    (technique, index) => {
      const prompt = substituteTemplate(
        technique.promptTemplate,
        "1",
        domain,
        input.problemArea,
      );
      return {
        index,
        technique,
        prompt,
        requiredFields: technique.requiredOutputFields,
      };
    },
  );

  // Insert idea_runs record to track this generation session
  const [runRecord] = await db
    .insert(ideaRuns)
    .values({
      domain: input.domain ?? null,
      candidateCount,
      passCount: 0,
    })
    .returning({ id: ideaRuns.id });

  const runId = runRecord.id;

  console.error(`[generation] Created idea_run ${runId} with ${candidateCount} candidates`);

  // Build structured pipeline instructions to execute per candidate
  const pipelineSteps = `For EACH candidate below:
1. Generate the idea content following the required fields using the candidate's specific prompt
2. Call idea_lab_save_idea with all fields + runId "${runId}" to persist the idea
3. Call idea_lab_score_idea with the returned ideaId — read the scoring-rubric resource first if not already loaded
4. If score passes thresholds: call idea_lab_critique_idea — search web for existing products first
5. If critique passes (not blocked): call idea_lab_check_duplicate
6. Track results for all candidates (pass or fail) for the final summary

After ALL candidates are processed:
- Report: total candidates, passed scoring, passed critique, passed dedup, stored
- For top 1-2 stored ideas with highest composite score: call idea_lab_promote_idea to set status "shortlisted"`;

  // Build software-only reminder from constraintsConfig
  const rejectionList = constraintsConfig.softwareOnly.rejectionCriteria.join(
    "; ",
  );
  const softwareOnlyReminder = `CONSTRAINT: ${constraintsConfig.softwareOnly.description} Reject criteria: ${rejectionList}`;

  // Query top rejection patterns and build anti-pattern block
  const topPatterns = await getTopPatterns(10);
  let antiPatternBlock = "";
  if (topPatterns.length > 0) {
    const patternList = topPatterns
      .map((p, i) => `${i + 1}. ${p.patternText} (seen ${p.frequencyCount}x)`)
      .join("\n");
    antiPatternBlock = `\nAVOID THESE PATTERNS (learned from past rejections):\n${patternList}\n`;
  }

  // If diversify is requested, query portfolio gaps
  let diversifyBlock = "";
  if (input.diversify) {
    const underrepresented = await getUnderrepresentedDomains();
    if (underrepresented.length > 0) {
      diversifyBlock = `\nPORTFOLIO DIVERSIFICATION: Prioritize ideas in these underrepresented domains: ${underrepresented.join(", ")}. Aim for at least half of candidates to target these domains.\n`;
    }
  }

  return {
    runId,
    candidateCount,
    instructions,
    pipelineSteps,
    softwareOnlyReminder,
    antiPatterns: antiPatternBlock,
    diversifyGuidance: diversifyBlock,
  };
}

// Re-export Technique for downstream consumers
export { techniquesConfig };

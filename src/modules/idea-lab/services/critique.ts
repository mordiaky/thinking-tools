import { db } from "../../../db/client.js";
import { critiques } from "../../../db/schema.js";
import { extractAndUpsertPattern } from "./rejection-patterns.js";

export interface CritiqueFindings {
  wrapperProblem: string | null;
  existingProducts: string | null;
  fragileDependencies: string | null;
  vagueStatement: string | null;
  violatesSoftwareOnly: boolean;
  overallVerdict: "pass" | "weak" | "reject";
  verdictReasoning: string;
}

export interface CritiqueInput {
  ideaId: string;
  findings: CritiqueFindings;
}

export interface CritiqueResult {
  critiqueId: string;
  verdict: "pass" | "weak" | "reject";
  verdictReasoning: string;
  blocked: boolean;
  nextStep: string;
}

export async function saveCritique(input: CritiqueInput): Promise<CritiqueResult> {
  const { findings } = input;

  // Build content summary from non-null findings
  const contentParts: string[] = [];
  if (findings.wrapperProblem) {
    contentParts.push(`Wrapper problem: ${findings.wrapperProblem}`);
  }
  if (findings.existingProducts) {
    contentParts.push(`Existing products: ${findings.existingProducts}`);
  }
  if (findings.fragileDependencies) {
    contentParts.push(`Fragile dependencies: ${findings.fragileDependencies}`);
  }
  if (findings.vagueStatement) {
    contentParts.push(`Vague statement: ${findings.vagueStatement}`);
  }
  if (findings.violatesSoftwareOnly) {
    contentParts.push(`Violates software-only constraint: yes`);
  }
  contentParts.push(`Overall verdict: ${findings.overallVerdict}`);
  contentParts.push(`Verdict reasoning: ${findings.verdictReasoning}`);
  const summaryContent = contentParts.join("\n");

  // Insert into critiques table
  const [inserted] = await db.insert(critiques).values({
    ideaId: input.ideaId,
    content: summaryContent,
    wrapperProblem: findings.wrapperProblem,
    existingProducts: findings.existingProducts,
    fragileDependencies: findings.fragileDependencies,
    vagueStatement: findings.vagueStatement,
    violatesSoftwareOnly: findings.violatesSoftwareOnly ? "yes" : null,
    overallVerdict: findings.overallVerdict,
    verdictReasoning: findings.verdictReasoning,
  }).returning({ id: critiques.id });

  const critiqueId = inserted.id;

  // Extract rejection pattern for non-pass verdicts (immune memory)
  if (findings.overallVerdict === "reject" || findings.overallVerdict === "weak") {
    await extractAndUpsertPattern(critiqueId, findings.verdictReasoning);
  }

  // Determine if critique blocks the idea
  // Hard block: reject verdict or software-only violation
  const blocked =
    findings.overallVerdict === "reject" || findings.violatesSoftwareOnly;

  if (blocked) {
    return {
      critiqueId,
      verdict: findings.overallVerdict,
      verdictReasoning: findings.verdictReasoning,
      blocked: true,
      nextStep:
        "Idea rejected by critique. Do not proceed to duplicate check or storage.",
    };
  }

  return {
    critiqueId,
    verdict: findings.overallVerdict,
    verdictReasoning: findings.verdictReasoning,
    blocked: false,
    nextStep: "Call idea_lab_check_duplicate with this ideaId.",
  };
}

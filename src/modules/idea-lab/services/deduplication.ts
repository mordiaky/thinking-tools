import { db } from "../../../db/client.js";
import { ideas } from "../../../db/schema.js";
import { ne } from "drizzle-orm";

export interface IdeaSummary {
  id: string;
  title: string;
  oneLiner: string;
  problem: string;
  solution: string;
}

export interface DuplicateMatch {
  storedIdeaId: string;
  reason: string;
  similarityLevel: "identical" | "near-identical" | "same-core";
}

export interface DuplicateCheckInput {
  ideaId: string;
  isDuplicate: boolean;
  duplicateOf?: DuplicateMatch[];
}

export interface DuplicateCheckResult {
  blocked: boolean;
  duplicateOf: DuplicateMatch[];
  nextStep: string;
}

/**
 * Fetch stored idea summaries (summary fields only — context-efficient per design).
 * Excludes the idea being checked to avoid self-comparison.
 */
export async function getStoredIdeaSummaries(
  excludeIdeaId: string,
): Promise<IdeaSummary[]> {
  return db
    .select({
      id: ideas.id,
      title: ideas.title,
      oneLiner: ideas.oneLiner,
      problem: ideas.problem,
      solution: ideas.solution,
    })
    .from(ideas)
    .where(ne(ideas.id, excludeIdeaId));
}

/**
 * Record the duplicate comparison result and enforce the duplicate gate.
 * This service does NOT perform the comparison — the caller does (D-12, D-15).
 * The service records the result and enforces the gate (D-13).
 */
export async function recordDuplicateCheck(
  input: DuplicateCheckInput,
): Promise<DuplicateCheckResult> {
  if (input.isDuplicate === true && input.duplicateOf && input.duplicateOf.length > 0) {
    return {
      blocked: true,
      duplicateOf: input.duplicateOf,
      nextStep:
        "Idea is too similar to stored ideas. Do not store. Show user which ideas it duplicates.",
    };
  }

  return {
    blocked: false,
    duplicateOf: [],
    nextStep:
      "Call idea_lab_save_idea with this ideaId to persist the idea.",
  };
}

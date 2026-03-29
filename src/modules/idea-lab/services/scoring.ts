import { db } from "../../../db/client.js";
import { scores, ideas } from "../../../db/schema.js";
import { eq } from "drizzle-orm";
import { rubricConfig } from "../../../config/rubric.js";

export interface DimensionScores {
  novelty: number;
  usefulness: number;
  feasibility: number;
  testability: number;
  speedToMvp: number;
  defensibility: number;
  clarity: number;
}

export interface DimensionReasoning {
  novelty: string;
  usefulness: string;
  feasibility: string;
  testability: string;
  speedToMvp: string;
  defensibility: string;
  clarity: string;
}

export interface ThresholdOverrides {
  feasibility?: number;
  usefulness?: number;
  novelty?: number;
  composite?: number;
}

export interface ScoreInput {
  ideaId: string;
  scores: DimensionScores;
  reasoning: DimensionReasoning;
  thresholds?: ThresholdOverrides;
  scoreType?: 'initial' | 'rescore';
  marketContext?: string | null;
}

export interface ThresholdFailure {
  dimension: string;
  score: number;
  threshold: number;
  gap: number;
}

export interface ScoreResult {
  passed: boolean;
  composite: number;
  failures: ThresholdFailure[];
  scoreId: string;
  nextStep: string;
}

export async function saveScore(input: ScoreInput): Promise<ScoreResult> {
  // Compute weighted composite from 6 dimensions (clarity excluded per D-06 / clarityGate.includedInComposite = false)
  const composite =
    input.scores.novelty * rubricConfig.weights.novelty +
    input.scores.usefulness * rubricConfig.weights.usefulness +
    input.scores.feasibility * rubricConfig.weights.feasibility +
    input.scores.testability * rubricConfig.weights.testability +
    input.scores.speedToMvp * rubricConfig.weights.speedToMvp +
    input.scores.defensibility * rubricConfig.weights.defensibility;

  // Build effective thresholds merging per-run overrides with config defaults (D-17)
  const effective = {
    feasibility: input.thresholds?.feasibility ?? rubricConfig.thresholds.feasibility,
    usefulness: input.thresholds?.usefulness ?? rubricConfig.thresholds.usefulness,
    novelty: input.thresholds?.novelty ?? rubricConfig.thresholds.novelty,
    composite: input.thresholds?.composite ?? rubricConfig.thresholds.composite,
  };

  // Check threshold failures and build failures array
  const failures: ThresholdFailure[] = [];

  if (input.scores.feasibility < effective.feasibility) {
    failures.push({
      dimension: "feasibility",
      score: input.scores.feasibility,
      threshold: effective.feasibility,
      gap: effective.feasibility - input.scores.feasibility,
    });
  }

  if (input.scores.usefulness < effective.usefulness) {
    failures.push({
      dimension: "usefulness",
      score: input.scores.usefulness,
      threshold: effective.usefulness,
      gap: effective.usefulness - input.scores.usefulness,
    });
  }

  if (input.scores.novelty < effective.novelty) {
    failures.push({
      dimension: "novelty",
      score: input.scores.novelty,
      threshold: effective.novelty,
      gap: effective.novelty - input.scores.novelty,
    });
  }

  // Clarity gate: binary pass/fail — not included in composite (D-06)
  if (input.scores.clarity < rubricConfig.clarityGate.minimumScore) {
    failures.push({
      dimension: "clarity",
      score: input.scores.clarity,
      threshold: rubricConfig.clarityGate.minimumScore,
      gap: rubricConfig.clarityGate.minimumScore - input.scores.clarity,
    });
  }

  // Composite gate
  if (composite < effective.composite) {
    failures.push({
      dimension: "composite",
      score: composite,
      threshold: effective.composite,
      gap: effective.composite - composite,
    });
  }

  // ALWAYS persist the score record — D-05 (multiple records allowed, never skip on failure)
  const [inserted] = await db
    .insert(scores)
    .values({
      ideaId: input.ideaId,
      novelty: input.scores.novelty,
      usefulness: input.scores.usefulness,
      feasibility: input.scores.feasibility,
      testability: input.scores.testability,
      speedToMvp: input.scores.speedToMvp,
      defensibility: input.scores.defensibility,
      clarity: input.scores.clarity,
      composite,
      noveltyReasoning: input.reasoning.novelty,
      usefulnessReasoning: input.reasoning.usefulness,
      feasibilityReasoning: input.reasoning.feasibility,
      testabilityReasoning: input.reasoning.testability,
      speedToMvpReasoning: input.reasoning.speedToMvp,
      defensibilityReasoning: input.reasoning.defensibility,
      clarityReasoning: input.reasoning.clarity,
      scoreType: input.scoreType ?? 'initial',
      marketContext: input.marketContext ?? null,
      rubricSnapshot: JSON.stringify(rubricConfig.weights),
    })
    .returning({ id: scores.id });

  // Update ideas.lastScoredAt for efficient ORDER BY without MAX subqueries
  await db
    .update(ideas)
    .set({ lastScoredAt: new Date().toISOString() })
    .where(eq(ideas.id, input.ideaId));

  if (failures.length > 0) {
    return {
      passed: false,
      composite,
      failures,
      scoreId: inserted.id,
      nextStep: "Idea failed thresholds. Do not proceed to critique or storage.",
    };
  }

  return {
    passed: true,
    composite,
    failures: [],
    scoreId: inserted.id,
    nextStep: "Call idea_lab_critique_idea with this ideaId.",
  };
}

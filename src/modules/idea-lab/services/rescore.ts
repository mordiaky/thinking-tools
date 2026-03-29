import { db } from "../../../db/client.js";
import { ideas, scores, fermentationAlerts } from "../../../db/schema.js";
import { eq, desc, asc } from "drizzle-orm";
import {
  saveScore,
  DimensionScores,
  DimensionReasoning,
  ThresholdOverrides,
  ThresholdFailure,
} from "./scoring.js";

export interface RescoreInput {
  ideaId: string;
  scores: DimensionScores;
  reasoning: DimensionReasoning;
  marketContext?: string;
  thresholds?: ThresholdOverrides;
}

export interface ScoreDelta {
  dimension: string;
  prior: number;
  current: number;
  delta: number;
}

export interface RescoreResult {
  scoreId: string;
  passed: boolean;
  composite: number;
  previousComposite: number | null;
  compositeDelta: number;
  dimensionDeltas: ScoreDelta[];
  trajectory: "RISING" | "STABLE" | "DECLINING";
  alertTriggered: boolean;
  failures: ThresholdFailure[];
}

export interface ScoreHistoryEntry {
  scoreId: string;
  composite: number;
  scoreType: string;
  marketContext: string | null;
  rubricSnapshot: string | null;
  createdAt: string;
  delta: number | null;
  dimensionScores: DimensionScores & { clarity: number };
  reasoning?: {
    novelty: string | null;
    usefulness: string | null;
    feasibility: string | null;
    testability: string | null;
    speedToMvp: string | null;
    defensibility: string | null;
    clarity: string | null;
  };
}

export interface RescoreContext {
  idea: {
    id: string;
    title: string;
    oneLiner: string;
    problem: string;
    solution: string;
    whyNow: string | null;
    targetUser: string | null;
    domain: string | null;
    status: string;
  };
  priorScores: ScoreHistoryEntry[];
}

/**
 * Rescore an existing idea with optional market context. Creates a new score row
 * (never overwrites), computes deltas vs prior score, and triggers fermentation
 * alerts when composite delta >= 1.0.
 */
export async function rescoreIdea(input: RescoreInput): Promise<RescoreResult> {
  // Verify idea exists
  const ideaRows = await db
    .select({ id: ideas.id })
    .from(ideas)
    .where(eq(ideas.id, input.ideaId));

  if (ideaRows.length === 0) {
    throw new Error(`Idea not found: ${input.ideaId}`);
  }

  // Save the new score with scoreType='rescore' via existing saveScore (reuses threshold gates)
  const saveResult = await saveScore({
    ideaId: input.ideaId,
    scores: input.scores,
    reasoning: input.reasoning,
    thresholds: input.thresholds,
    scoreType: "rescore",
    marketContext: input.marketContext ?? null,
  });

  // Fetch two most recent score rows to compute delta
  const recentScores = await db
    .select({
      id: scores.id,
      composite: scores.composite,
      novelty: scores.novelty,
      usefulness: scores.usefulness,
      feasibility: scores.feasibility,
      testability: scores.testability,
      speedToMvp: scores.speedToMvp,
      defensibility: scores.defensibility,
      clarity: scores.clarity,
      createdAt: scores.createdAt,
    })
    .from(scores)
    .where(eq(scores.ideaId, input.ideaId))
    .orderBy(desc(scores.createdAt))
    .limit(2);

  const currentScore = recentScores[0];
  const previousScore = recentScores.length > 1 ? recentScores[1] : null;

  const previousComposite = previousScore?.composite ?? null;
  const compositeDelta = previousComposite !== null ? currentScore.composite - previousComposite : 0;

  // Compute per-dimension deltas
  const dimensionDeltas: ScoreDelta[] = [];
  const dimensions: Array<keyof DimensionScores | "clarity"> = [
    "novelty",
    "usefulness",
    "feasibility",
    "testability",
    "speedToMvp",
    "defensibility",
    "clarity",
  ];

  for (const dim of dimensions) {
    const current = currentScore[dim as keyof typeof currentScore] as number;
    const prior = previousScore ? (previousScore[dim as keyof typeof previousScore] as number) : current;
    dimensionDeltas.push({
      dimension: dim,
      prior,
      current,
      delta: current - prior,
    });
  }

  // Classify trajectory
  let trajectory: "RISING" | "STABLE" | "DECLINING";
  if (compositeDelta > 0.5) {
    trajectory = "RISING";
  } else if (compositeDelta < -0.5) {
    trajectory = "DECLINING";
  } else {
    trajectory = "STABLE";
  }

  // Insert fermentation alert if abs(compositeDelta) >= 1.0
  let alertTriggered = false;
  if (previousComposite !== null && Math.abs(compositeDelta) >= 1.0) {
    alertTriggered = true;

    let alertType: string;
    // Check if idea crossed composite promotion threshold
    const compositeThreshold = 6.5; // matches rubric default
    const crossedThreshold =
      previousComposite < compositeThreshold && currentScore.composite >= compositeThreshold;

    if (crossedThreshold) {
      alertType = "crossed_threshold";
    } else if (compositeDelta > 0) {
      alertType = "large_positive_delta";
    } else {
      alertType = "large_negative_delta";
    }

    await db.insert(fermentationAlerts).values({
      ideaId: input.ideaId,
      alertType,
      previousComposite: previousComposite,
      newComposite: currentScore.composite,
      delta: compositeDelta,
    });
  }

  return {
    scoreId: saveResult.scoreId,
    passed: saveResult.passed,
    composite: saveResult.composite,
    previousComposite,
    compositeDelta,
    dimensionDeltas,
    trajectory,
    alertTriggered,
    failures: saveResult.failures,
  };
}

/**
 * Returns the complete score timeline for an idea, ordered chronologically.
 * Computes delta between consecutive rows (first row has delta=null).
 */
export async function getScoreHistory(ideaId: string): Promise<ScoreHistoryEntry[]> {
  const rows = await db
    .select({
      id: scores.id,
      composite: scores.composite,
      novelty: scores.novelty,
      usefulness: scores.usefulness,
      feasibility: scores.feasibility,
      testability: scores.testability,
      speedToMvp: scores.speedToMvp,
      defensibility: scores.defensibility,
      clarity: scores.clarity,
      scoreType: scores.scoreType,
      marketContext: scores.marketContext,
      rubricSnapshot: scores.rubricSnapshot,
      createdAt: scores.createdAt,
      noveltyReasoning: scores.noveltyReasoning,
      usefulnessReasoning: scores.usefulnessReasoning,
      feasibilityReasoning: scores.feasibilityReasoning,
      testabilityReasoning: scores.testabilityReasoning,
      speedToMvpReasoning: scores.speedToMvpReasoning,
      defensibilityReasoning: scores.defensibilityReasoning,
      clarityReasoning: scores.clarityReasoning,
    })
    .from(scores)
    .where(eq(scores.ideaId, ideaId))
    .orderBy(asc(scores.createdAt));

  return rows.map((row, index) => {
    const prev = index > 0 ? rows[index - 1] : null;
    const delta = prev !== null ? row.composite - prev.composite : null;

    return {
      scoreId: row.id,
      composite: row.composite,
      scoreType: row.scoreType,
      marketContext: row.marketContext,
      rubricSnapshot: row.rubricSnapshot,
      createdAt: row.createdAt,
      delta,
      dimensionScores: {
        novelty: row.novelty,
        usefulness: row.usefulness,
        feasibility: row.feasibility,
        testability: row.testability,
        speedToMvp: row.speedToMvp,
        defensibility: row.defensibility,
        clarity: row.clarity,
      },
      reasoning: {
        novelty: row.noveltyReasoning,
        usefulness: row.usefulnessReasoning,
        feasibility: row.feasibilityReasoning,
        testability: row.testabilityReasoning,
        speedToMvp: row.speedToMvpReasoning,
        defensibility: row.defensibilityReasoning,
        clarity: row.clarityReasoning,
      },
    };
  });
}

/**
 * Returns idea content and full prior score history for Step 1 of the two-step
 * rescore tool. Provides Claude with context for web search before rescoring.
 */
export async function getRescoreContext(ideaId: string): Promise<RescoreContext | { error: string }> {
  const ideaRows = await db
    .select({
      id: ideas.id,
      title: ideas.title,
      oneLiner: ideas.oneLiner,
      problem: ideas.problem,
      solution: ideas.solution,
      whyNow: ideas.whyNow,
      targetUser: ideas.targetUser,
      domain: ideas.domain,
      status: ideas.status,
    })
    .from(ideas)
    .where(eq(ideas.id, ideaId));

  if (ideaRows.length === 0) {
    return { error: `Idea not found: ${ideaId}` };
  }

  const priorScores = await getScoreHistory(ideaId);

  return {
    idea: ideaRows[0],
    priorScores,
  };
}

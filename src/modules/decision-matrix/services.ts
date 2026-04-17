import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  decisions,
  decisionCriteria,
  decisionOptions,
  decisionRatings,
} from "../../db/schema.js";
import type {
  Decision,
  DecisionCriteria,
  DecisionOption,
  DecisionRating,
} from "../../db/schema.js";

export interface CriterionBreakdown {
  criterion_id: string;
  criterion_name: string;
  criterion_weight: number;
  score: number | null;
  reasoning: string | null;
  weighted_score: number;
}

export interface RankedOption {
  option_id: string;
  option_name: string;
  option_description: string | null;
  weighted_score: number;
  breakdown: CriterionBreakdown[];
}

export interface DecisionWithDetails {
  decision: Decision;
  criteria: DecisionCriteria[];
  options: DecisionOption[];
  ratings: DecisionRating[];
  ranked_options?: RankedOption[];
}

export function createDecision(title: string, description?: string): Decision {
  const rows = db
    .insert(decisions)
    .values({
      title,
      description: description ?? null,
    })
    .returning()
    .all();
  return rows[0];
}

export function addCriterion(
  decisionId: string,
  name: string,
  weight: number,
  description?: string,
): DecisionCriteria {
  if (!Number.isFinite(weight) || weight <= 0) {
    throw new Error(`weight must be a positive finite number, got ${weight}`);
  }

  const dec = db.select().from(decisions).where(eq(decisions.id, decisionId)).all();
  if (dec.length === 0) {
    throw new Error(`Decision not found: ${decisionId}`);
  }

  const rows = db
    .insert(decisionCriteria)
    .values({
      decisionId,
      name,
      weight,
      description: description ?? null,
    })
    .returning()
    .all();
  return rows[0];
}

export function addOption(
  decisionId: string,
  name: string,
  description?: string,
): DecisionOption {
  const dec = db.select().from(decisions).where(eq(decisions.id, decisionId)).all();
  if (dec.length === 0) {
    throw new Error(`Decision not found: ${decisionId}`);
  }

  const rows = db
    .insert(decisionOptions)
    .values({
      decisionId,
      name,
      description: description ?? null,
    })
    .returning()
    .all();
  return rows[0];
}

export function rateOption(
  optionId: string,
  criterionId: string,
  score: number,
  reasoning?: string,
): DecisionRating {
  // Validate both exist
  const opt = db.select().from(decisionOptions).where(eq(decisionOptions.id, optionId)).all();
  if (opt.length === 0) {
    throw new Error(`Option not found: ${optionId}`);
  }

  const crit = db.select().from(decisionCriteria).where(eq(decisionCriteria.id, criterionId)).all();
  if (crit.length === 0) {
    throw new Error(`Criterion not found: ${criterionId}`);
  }

  // Validate they belong to the same decision
  if (opt[0].decisionId !== crit[0].decisionId) {
    throw new Error("Option and criterion belong to different decisions");
  }

  // Check if rating already exists — upsert by deleting + inserting
  const existing = db
    .select()
    .from(decisionRatings)
    .where(eq(decisionRatings.optionId, optionId))
    .all()
    .filter((r) => r.criterionId === criterionId);

  if (existing.length > 0) {
    db.delete(decisionRatings).where(eq(decisionRatings.id, existing[0].id)).run();
  }

  const rows = db
    .insert(decisionRatings)
    .values({
      optionId,
      criterionId,
      score,
      reasoning: reasoning ?? null,
    })
    .returning()
    .all();
  return rows[0];
}

export function evaluateDecision(decisionId: string): RankedOption[] {
  const dec = db.select().from(decisions).where(eq(decisions.id, decisionId)).all();
  if (dec.length === 0) {
    throw new Error(`Decision not found: ${decisionId}`);
  }

  const criteria = db.select().from(decisionCriteria).where(eq(decisionCriteria.decisionId, decisionId)).all();
  const options = db.select().from(decisionOptions).where(eq(decisionOptions.decisionId, decisionId)).all();
  const ratings = db.select().from(decisionRatings).all();

  const totalWeight = criteria.reduce((sum, c) => sum + (c.weight ?? 1), 0);

  const rankedOptions: RankedOption[] = options.map((opt) => {
    const breakdown: CriterionBreakdown[] = criteria.map((crit) => {
      const rating = ratings.find(
        (r) => r.optionId === opt.id && r.criterionId === crit.id,
      );
      const score = rating?.score ?? null;
      const weight = crit.weight ?? 1;
      const weightedScore = score !== null ? (score * weight) / (totalWeight || 1) : 0;

      return {
        criterion_id: crit.id,
        criterion_name: crit.name,
        criterion_weight: weight,
        score,
        reasoning: rating?.reasoning ?? null,
        weighted_score: +weightedScore.toFixed(4),
      };
    });

    const weightedScore = breakdown.reduce((sum, b) => sum + b.weighted_score, 0);

    return {
      option_id: opt.id,
      option_name: opt.name,
      option_description: opt.description ?? null,
      weighted_score: +weightedScore.toFixed(4),
      breakdown,
    };
  });

  return rankedOptions.sort((a, b) => b.weighted_score - a.weighted_score);
}

export function getDecision(id: string): DecisionWithDetails | null {
  const dec = db.select().from(decisions).where(eq(decisions.id, id)).all();
  if (dec.length === 0) return null;

  const criteria = db.select().from(decisionCriteria).where(eq(decisionCriteria.decisionId, id)).all();
  const options = db.select().from(decisionOptions).where(eq(decisionOptions.decisionId, id)).all();
  const optionIds = options.map((o) => o.id);
  const ratings = optionIds.length > 0
    ? db.select().from(decisionRatings).all().filter((r) => optionIds.includes(r.optionId))
    : [];

  const ranked_options = evaluateDecision(id);

  return {
    decision: dec[0],
    criteria,
    options,
    ratings,
    ranked_options,
  };
}

export function listDecisions(status?: string): Decision[] {
  if (!status || status === "all") {
    return db.select().from(decisions).all();
  }
  return db.select().from(decisions).where(eq(decisions.status, status)).all();
}

export function decideOption(decisionId: string, optionId: string): Decision {
  const dec = db.select().from(decisions).where(eq(decisions.id, decisionId)).all();
  if (dec.length === 0) {
    throw new Error(`Decision not found: ${decisionId}`);
  }

  const opt = db.select().from(decisionOptions).where(eq(decisionOptions.id, optionId)).all();
  if (opt.length === 0) {
    throw new Error(`Option not found: ${optionId}`);
  }

  if (opt[0].decisionId !== decisionId) {
    throw new Error("Option does not belong to this decision");
  }

  const timestamp = new Date().toISOString();
  db.update(decisions)
    .set({
      chosenOptionId: optionId,
      status: "decided",
      decidedAt: timestamp,
      updatedAt: timestamp,
    })
    .where(eq(decisions.id, decisionId))
    .run();

  const result = db.select().from(decisions).where(eq(decisions.id, decisionId)).all();
  if (result.length === 0) {
    throw new Error(`Decision not found after update: ${decisionId}`);
  }
  return result[0];
}

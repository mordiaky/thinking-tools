/**
 * Bayesian confidence update logic for hypothesis tracking.
 *
 * When evidence is added, the confidence is updated based on the type
 * and weight of the evidence. Results are clamped to [0.01, 0.99]
 * to avoid certainty.
 */

const STRENGTH_FACTOR = 0.6;

export function updateConfidence(
  prior: number,
  evidenceType: "supporting" | "contradicting" | "neutral",
  weight: number,
): number {
  if (prior < 0 || prior > 1) {
    throw new Error(`prior must be between 0 and 1, got ${prior}`);
  }
  if (weight < 0 || weight > 1) {
    throw new Error(`weight must be between 0 and 1, got ${weight}`);
  }

  let newConfidence: number;

  switch (evidenceType) {
    case "supporting":
      newConfidence = prior + weight * (1 - prior) * STRENGTH_FACTOR;
      break;
    case "contradicting":
      newConfidence = prior - weight * prior * STRENGTH_FACTOR;
      break;
    case "neutral":
      // Minimal adjustment: nudge toward 0.5
      newConfidence = prior + weight * (0.5 - prior) * STRENGTH_FACTOR * 0.1;
      break;
  }

  return clamp(newConfidence);
}

function clamp(value: number): number {
  return Math.max(0.01, Math.min(0.99, value));
}

/**
 * Cross-module integrations.
 *
 * Keeps coupling between modules in one place. Each function here is:
 *   - Idempotent: safe to call repeatedly without duplicating downstream records.
 *   - Observable: returns a summary describing what (if anything) it created.
 *   - Best-effort: integration failures must never break the primary tool call.
 *     The caller should swallow errors and surface them as a warning.
 *
 * Cross-module records are linked via a JSON-encoded `context` field:
 *   `{"source":"idea_lab","ideaId":"abc-..."}`
 * This avoids schema migrations while preserving traceability.
 */

import { and, eq, like } from "drizzle-orm";
import { db, sqlite } from "../../db/client.js";
import {
  ideas,
  scores,
  assumptions,
  hypotheses,
  confidenceHistory,
} from "../../db/schema.js";
import { randomUUID } from "node:crypto";
import type { CritiqueFindings } from "../idea-lab/services/critique.js";

export interface IntegrationSource {
  source: string;
  ideaId?: string;
  critiqueId?: string;
  [key: string]: unknown;
}

/** Encode a source descriptor for storage in a `context` column. */
export function encodeSource(src: IntegrationSource): string {
  return JSON.stringify(src);
}

/** Parse a source descriptor; returns null if the context is not an integration marker. */
export function parseSource(raw: string | null | undefined): IntegrationSource | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.source === "string") {
      return parsed as IntegrationSource;
    }
  } catch {
    // Not all context strings are JSON — that's fine, return null.
  }
  return null;
}

// ============================================================
// Idea promotion -> Hypothesis auto-tracking
// ============================================================

export interface IdeaHypothesisLink {
  hypothesisId: string;
  ideaId: string;
  initialConfidence: number;
  created: boolean; // false if an existing link was returned
}

/**
 * Find any hypothesis previously auto-created for this idea. Matches on the
 * JSON marker in `context`.
 */
function findHypothesisForIdea(ideaId: string): string | null {
  const marker = `"ideaId":"${ideaId}"`;
  const rows = db
    .select({ id: hypotheses.id })
    .from(hypotheses)
    .where(like(hypotheses.context, `%${marker}%`))
    .all();
  return rows.length > 0 ? rows[0].id : null;
}

/**
 * When an idea is promoted to `shortlisted` or `build-next`, create a
 * hypothesis seeded at the idea's composite score (scaled to [0,1]).
 *
 * Returns null if the idea has no score yet (can't seed confidence).
 * Returns an existing link (created=false) if this idea is already tracked.
 */
export function trackIdeaAsHypothesis(ideaId: string): IdeaHypothesisLink | null {
  const existingId = findHypothesisForIdea(ideaId);
  if (existingId) {
    const existing = db
      .select({ id: hypotheses.id, confidence: hypotheses.confidence })
      .from(hypotheses)
      .where(eq(hypotheses.id, existingId))
      .all()[0];
    return {
      hypothesisId: existing.id,
      ideaId,
      initialConfidence: existing.confidence,
      created: false,
    };
  }

  const ideaRows = db
    .select({
      id: ideas.id,
      title: ideas.title,
      oneLiner: ideas.oneLiner,
    })
    .from(ideas)
    .where(eq(ideas.id, ideaId))
    .all();
  if (ideaRows.length === 0) return null;
  const idea = ideaRows[0];

  const scoreRows = db
    .select({ composite: scores.composite, createdAt: scores.createdAt })
    .from(scores)
    .where(eq(scores.ideaId, ideaId))
    .all();
  if (scoreRows.length === 0) return null;
  const latest = scoreRows.sort((a, b) =>
    (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
  )[0];

  const initialConfidence = Math.max(0.01, Math.min(0.99, latest.composite / 10));
  const hypothesisId = `hyp_${randomUUID()}`;
  const timestamp = new Date().toISOString();
  const context = encodeSource({ source: "idea_lab", ideaId });

  const insert = sqlite.transaction(() => {
    db.insert(hypotheses)
      .values({
        id: hypothesisId,
        title: `Idea: ${idea.title}`,
        description: `This idea delivers real user value. ${idea.oneLiner}`,
        confidence: initialConfidence,
        status: "active",
        tags: JSON.stringify(["auto-tracked", "from-idea-lab"]),
        context,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();

    db.insert(confidenceHistory)
      .values({
        id: `ch_${randomUUID()}`,
        hypothesisId,
        confidence: initialConfidence,
        reason: `Seeded from idea composite score (${latest.composite.toFixed(2)}/10)`,
        createdAt: timestamp,
      })
      .run();
  });
  insert();

  return { hypothesisId, ideaId, initialConfidence, created: true };
}

// ============================================================
// Critique findings -> Assumptions
// ============================================================

export interface CritiqueAssumptionLink {
  assumptionId: string;
  statement: string;
  impact: string;
}

export interface SpawnedAssumptionsResult {
  ideaId: string;
  assumptions: CritiqueAssumptionLink[];
  skipped: number; // existing assumptions left untouched
}

function findAssumptionForCritique(
  ideaId: string,
  kind: string,
): string | null {
  const marker = `"ideaId":"${ideaId}"`;
  const kindMarker = `"kind":"${kind}"`;
  const rows = db
    .select({ id: assumptions.id })
    .from(assumptions)
    .where(
      and(
        like(assumptions.context, `%${marker}%`),
        like(assumptions.context, `%${kindMarker}%`),
      ),
    )
    .all();
  return rows.length > 0 ? rows[0].id : null;
}

function spawn(
  ideaId: string,
  kind: string,
  statement: string,
  impact: "low" | "medium" | "high" | "critical",
): CritiqueAssumptionLink {
  const context = encodeSource({ source: "idea_lab_critique", ideaId, kind });
  const rows = db
    .insert(assumptions)
    .values({
      statement,
      context,
      impact,
      confidence: 0.5,
      source: "idea_lab_critique",
      status: "untested",
      tags: JSON.stringify(["auto-spawned", "from-critique", kind]),
    })
    .returning({ id: assumptions.id })
    .all();
  return { assumptionId: rows[0].id, statement, impact };
}

/**
 * Spawn assumptions for critique findings that reveal unverified beliefs.
 *
 * Mapping:
 *   - fragileDependencies -> "The dependency will remain stable/available" (high)
 *   - existingProducts    -> "Users will choose this over existing alternatives" (critical)
 *
 * Idempotent: repeated calls for the same idea do not create duplicates.
 */
export function spawnAssumptionsFromCritique(
  ideaId: string,
  findings: CritiqueFindings,
): SpawnedAssumptionsResult {
  const result: SpawnedAssumptionsResult = {
    ideaId,
    assumptions: [],
    skipped: 0,
  };

  if (findings.fragileDependencies) {
    if (findAssumptionForCritique(ideaId, "fragile_dependency")) {
      result.skipped += 1;
    } else {
      result.assumptions.push(
        spawn(
          ideaId,
          "fragile_dependency",
          `The dependency will remain stable and available: ${findings.fragileDependencies}`,
          "high",
        ),
      );
    }
  }

  if (findings.existingProducts) {
    if (findAssumptionForCritique(ideaId, "vs_existing_products")) {
      result.skipped += 1;
    } else {
      result.assumptions.push(
        spawn(
          ideaId,
          "vs_existing_products",
          `Users will choose this idea over existing alternatives: ${findings.existingProducts}`,
          "critical",
        ),
      );
    }
  }

  return result;
}

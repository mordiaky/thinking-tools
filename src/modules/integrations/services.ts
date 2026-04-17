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
  critiques,
  assumptions,
  hypotheses,
  evidence,
  confidenceHistory,
  decisions,
  decisionOptions,
  contradictions,
  fermentationAlerts,
  ideaVariants,
  learningEntries,
  tags as tagsTable,
  ideaTags,
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

// ============================================================
// Shortlist -> Decision Matrix
// ============================================================

export interface DecisionFromShortlistResult {
  decisionId: string;
  title: string;
  optionCount: number;
  options: Array<{ optionId: string; ideaId: string; name: string }>;
  seededIdeaIds: string[];
}

/**
 * Build a decision seeded with the caller's shortlisted (or explicitly
 * provided) ideas as options. Criteria are left to the caller to add;
 * options carry a context marker tying them back to the source idea.
 *
 * If no ideaIds are provided, every currently-shortlisted idea is used.
 */
export function createDecisionFromShortlist(
  title: string,
  description: string | undefined,
  ideaIds: string[] | undefined,
): DecisionFromShortlistResult {
  const targetIds = ideaIds && ideaIds.length > 0
    ? ideaIds
    : db
        .select({ id: ideas.id })
        .from(ideas)
        .where(eq(ideas.status, "shortlisted"))
        .all()
        .map((r) => r.id);

  if (targetIds.length === 0) {
    throw new Error(
      "No shortlisted ideas available. Shortlist at least one idea before creating a decision, or pass ideaIds explicitly.",
    );
  }

  const decisionId = randomUUID();
  const now = new Date().toISOString();

  const seed = sqlite.transaction(() => {
    db.insert(decisions)
      .values({
        id: decisionId,
        title,
        description: description ?? null,
        status: "open",
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });
  seed();

  const seeded: Array<{ optionId: string; ideaId: string; name: string }> = [];
  for (const ideaId of targetIds) {
    const ideaRows = db
      .select({ id: ideas.id, title: ideas.title, oneLiner: ideas.oneLiner })
      .from(ideas)
      .where(eq(ideas.id, ideaId))
      .all();
    if (ideaRows.length === 0) continue;
    const idea = ideaRows[0];

    const optionId = randomUUID();
    db.insert(decisionOptions)
      .values({
        id: optionId,
        decisionId,
        name: idea.title,
        description: `${idea.oneLiner}\n\n[source: idea_lab ideaId=${idea.id}]`,
        createdAt: now,
      })
      .run();

    seeded.push({ optionId, ideaId: idea.id, name: idea.title });
  }

  return {
    decisionId,
    title,
    optionCount: seeded.length,
    options: seeded,
    seededIdeaIds: targetIds,
  };
}

// ============================================================
// suggest_next_action — cross-module state reader
// ============================================================

export interface Suggestion {
  priority: number; // 1 = highest
  category:
    | "untested_critical_assumption"
    | "unresolved_contradiction"
    | "stale_hypothesis"
    | "shortlist_ready_for_decision"
    | "unscored_idea"
    | "fermentation_alert_unacknowledged"
    | "critique_pending";
  message: string;
  targetId?: string;
  targetKind?: string;
  recommendedTool: string;
  context?: Record<string, unknown>;
}

export interface SuggestNextActionResult {
  suggestions: Suggestion[];
  stateSummary: {
    activeHypotheses: number;
    untestedAssumptions: number;
    untestedCritical: number;
    unresolvedContradictions: number;
    shortlistedIdeas: number;
    unseenFermentationAlerts: number;
    unscoredIdeas: number;
    ideasAwaitingCritique: number;
  };
}

function daysBetween(iso: string | null | undefined, nowMs: number): number {
  if (!iso) return Infinity;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return Infinity;
  return (nowMs - ts) / (1000 * 60 * 60 * 24);
}

/**
 * Surface the next most useful action across every module. Heuristic
 * priority (highest-first):
 *
 *   1. Untested critical assumptions
 *   2. Unresolved contradictions
 *   3. Shortlisted ideas ready for decision (>=2 shortlisted, no open decision)
 *   4. Stale active hypotheses (>14 days old, no evidence in >7 days)
 *   5. Unacknowledged fermentation alerts
 *   6. Ideas with scores but no critique
 *   7. Raw ideas missing scores
 *
 * The top few are returned sorted. Consumers should pick one, not all.
 */
export function suggestNextAction(
  maxSuggestions: number = 5,
): SuggestNextActionResult {
  const now = Date.now();
  const suggestions: Suggestion[] = [];

  // --- Assumptions ---
  const allAssumptions = db.select().from(assumptions).all();
  const untestedAssumptions = allAssumptions.filter((a) => a.status === "untested");
  const untestedCritical = untestedAssumptions.filter(
    (a) => a.impact === "critical",
  );

  for (const a of untestedCritical.slice(0, 2)) {
    suggestions.push({
      priority: 1,
      category: "untested_critical_assumption",
      message: `Critical untested assumption blocking confidence: "${a.statement.slice(0, 120)}"`,
      targetId: a.id,
      targetKind: "assumption",
      recommendedTool: "assumption_test",
      context: { impact: a.impact, confidence: a.confidence },
    });
  }

  // --- Contradictions ---
  const unresolvedContradictions = db
    .select()
    .from(contradictions)
    .where(eq(contradictions.status, "unresolved"))
    .all();
  for (const c of unresolvedContradictions.slice(0, 2)) {
    suggestions.push({
      priority: 2,
      category: "unresolved_contradiction",
      message: `Unresolved contradiction: ${c.explanation.slice(0, 140)}`,
      targetId: c.id,
      targetKind: "contradiction",
      recommendedTool: "contradiction_resolve",
    });
  }

  // --- Shortlist ready for decision ---
  const shortlisted = db
    .select({ id: ideas.id })
    .from(ideas)
    .where(eq(ideas.status, "shortlisted"))
    .all();
  const openDecisions = db
    .select()
    .from(decisions)
    .where(eq(decisions.status, "open"))
    .all();
  if (shortlisted.length >= 2 && openDecisions.length === 0) {
    suggestions.push({
      priority: 3,
      category: "shortlist_ready_for_decision",
      message: `${shortlisted.length} shortlisted ideas but no open decision. Consider comparing them with a decision matrix.`,
      recommendedTool: "decision_create_from_shortlist",
      context: { shortlistCount: shortlisted.length },
    });
  }

  // --- Stale hypotheses ---
  const activeHypotheses = db
    .select()
    .from(hypotheses)
    .where(eq(hypotheses.status, "active"))
    .all();
  const staleHypotheses = activeHypotheses.filter(
    (h) => daysBetween(h.updatedAt, now) > 14,
  );
  for (const h of staleHypotheses.slice(0, 2)) {
    suggestions.push({
      priority: 4,
      category: "stale_hypothesis",
      message: `Hypothesis hasn't been updated in >14 days: "${h.title.slice(0, 120)}"`,
      targetId: h.id,
      targetKind: "hypothesis",
      recommendedTool: "hypothesis_add_evidence",
      context: {
        confidence: h.confidence,
        lastUpdated: h.updatedAt,
      },
    });
  }

  // --- Fermentation alerts ---
  const alerts = db
    .select()
    .from(fermentationAlerts)
    .all();
  const unseenAlerts = alerts.filter((a) => !a.acknowledgedAt);
  for (const a of unseenAlerts.slice(0, 2)) {
    suggestions.push({
      priority: 5,
      category: "fermentation_alert_unacknowledged",
      message: `Score moved significantly on idea: ${a.previousComposite.toFixed(2)} -> ${a.newComposite.toFixed(2)} (Δ${a.delta.toFixed(2)})`,
      targetId: a.ideaId,
      targetKind: "idea",
      recommendedTool: "idea_lab_mark_revalidated",
      context: { alertType: a.alertType },
    });
  }

  // --- Pipeline gaps: ideas with score but no critique ---
  const allIdeas = db
    .select({ id: ideas.id, title: ideas.title, status: ideas.status })
    .from(ideas)
    .all();
  const rawIdeas = allIdeas.filter((i) => i.status === "raw");
  const scoredIdeaIds = new Set(
    db.select({ ideaId: scores.ideaId }).from(scores).all().map((s) => s.ideaId),
  );
  const critiquedIdeaIds = new Set(
    db.select({ ideaId: critiques.ideaId }).from(critiques).all().map((c) => c.ideaId),
  );
  const ideasAwaitingCritique = rawIdeas.filter(
    (i) => scoredIdeaIds.has(i.id) && !critiquedIdeaIds.has(i.id),
  );
  for (const i of ideasAwaitingCritique.slice(0, 2)) {
    suggestions.push({
      priority: 6,
      category: "critique_pending",
      message: `Idea scored but not critiqued: "${i.title.slice(0, 120)}"`,
      targetId: i.id,
      targetKind: "idea",
      recommendedTool: "idea_lab_critique_idea",
    });
  }

  // --- Unscored raw ideas ---
  const unscored = rawIdeas.filter((i) => !scoredIdeaIds.has(i.id));
  for (const i of unscored.slice(0, 2)) {
    suggestions.push({
      priority: 7,
      category: "unscored_idea",
      message: `Idea not yet scored: "${i.title.slice(0, 120)}"`,
      targetId: i.id,
      targetKind: "idea",
      recommendedTool: "idea_lab_score_idea",
    });
  }

  suggestions.sort((a, b) => a.priority - b.priority);

  return {
    suggestions: suggestions.slice(0, maxSuggestions),
    stateSummary: {
      activeHypotheses: activeHypotheses.length,
      untestedAssumptions: untestedAssumptions.length,
      untestedCritical: untestedCritical.length,
      unresolvedContradictions: unresolvedContradictions.length,
      shortlistedIdeas: shortlisted.length,
      unseenFermentationAlerts: unseenAlerts.length,
      unscoredIdeas: unscored.length,
      ideasAwaitingCritique: ideasAwaitingCritique.length,
    },
  };
}

// ============================================================
// Retrospective learning — hypothesis resolution + assumption test
// ============================================================

export interface RetrospectiveResult {
  learningEntryId: string | null;
  created: boolean;
  reason?: string;
}

function learningEntryExistsFor(kind: string, targetId: string): boolean {
  const marker = `"kind":"${kind}"`;
  const idMarker = `"targetId":"${targetId}"`;
  const rows = db
    .select({ id: learningEntries.id })
    .from(learningEntries)
    .where(
      and(
        like(learningEntries.context, `%${marker}%`),
        like(learningEntries.context, `%${idMarker}%`),
      ),
    )
    .all();
  return rows.length > 0;
}

/**
 * Write a Learning Journal entry that captures initial confidence versus
 * final resolution for a hypothesis. Call this just AFTER the hypothesis
 * has been resolved. Idempotent per hypothesis.
 *
 * Classification:
 *   - initial > 0.7 and rejected      -> "mistake" (overconfident)
 *   - initial < 0.3 and confirmed     -> "surprise" (underconfident)
 *   - anything else                   -> "insight" (calibration data)
 */
export function retrospectiveForHypothesis(hypothesisId: string): RetrospectiveResult {
  if (learningEntryExistsFor("hypothesis_resolution", hypothesisId)) {
    return { learningEntryId: null, created: false, reason: "already-recorded" };
  }

  const rows = db.select().from(hypotheses).where(eq(hypotheses.id, hypothesisId)).all();
  if (rows.length === 0) {
    return { learningEntryId: null, created: false, reason: "hypothesis-not-found" };
  }
  const h = rows[0];
  if (h.status === "active") {
    return { learningEntryId: null, created: false, reason: "not-resolved-yet" };
  }

  const history = db
    .select()
    .from(confidenceHistory)
    .where(eq(confidenceHistory.hypothesisId, hypothesisId))
    .all()
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  const initialConfidence = history[0]?.confidence ?? 0.5;
  const resolved = h.resolution ?? h.status;
  const delta = Math.abs((h.confidence ?? 0.5) - initialConfidence);

  let entryType: "mistake" | "insight" | "surprise" = "insight";
  let severity: "low" | "medium" | "high" = "low";
  if (initialConfidence > 0.7 && resolved === "rejected") {
    entryType = "mistake";
    severity = "high";
  } else if (initialConfidence < 0.3 && resolved === "confirmed") {
    entryType = "surprise";
    severity = "medium";
  } else if (delta > 0.5) {
    severity = "medium";
  }

  const title = `Hypothesis ${resolved}: "${h.title.slice(0, 100)}"`;
  const content = [
    `Initial confidence: ${initialConfidence.toFixed(2)}`,
    `Final confidence:   ${(h.confidence ?? 0.5).toFixed(2)}`,
    `Resolution:         ${resolved}`,
    h.finalEvidence ? `Final evidence:     ${h.finalEvidence}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  let lesson: string;
  if (entryType === "mistake") {
    lesson = `Started with high confidence (${initialConfidence.toFixed(2)}) but the hypothesis was rejected. Look for earlier signals that could have lowered confidence sooner.`;
  } else if (entryType === "surprise") {
    lesson = `Started with low confidence (${initialConfidence.toFixed(2)}) but the hypothesis was confirmed. What evidence was underweighted during initial framing?`;
  } else {
    lesson = `Calibration data point: initial ${initialConfidence.toFixed(2)} → ${resolved}. Track this over many resolutions to identify systematic bias.`;
  }

  const context = encodeSource({
    source: "retrospective",
    kind: "hypothesis_resolution",
    targetId: hypothesisId,
  });

  const ins = db
    .insert(learningEntries)
    .values({
      entryType,
      title,
      content,
      lesson,
      context,
      severity,
      tags: JSON.stringify(["auto-retrospective", "hypothesis"]),
    })
    .returning({ id: learningEntries.id })
    .all();

  return { learningEntryId: ins[0].id, created: true };
}

/**
 * Write a Learning Journal entry for an assumption test. Same shape as
 * the hypothesis retrospective, but with assumption semantics.
 *
 * Classification:
 *   - impact=critical and invalidated  -> "mistake" (severity high)
 *   - impact=high and invalidated      -> "mistake" (severity medium)
 *   - validated                        -> "insight" (low severity)
 *   - anything else                    -> "correction" (medium severity)
 */
export function retrospectiveForAssumption(assumptionId: string): RetrospectiveResult {
  if (learningEntryExistsFor("assumption_test", assumptionId)) {
    return { learningEntryId: null, created: false, reason: "already-recorded" };
  }

  const rows = db.select().from(assumptions).where(eq(assumptions.id, assumptionId)).all();
  if (rows.length === 0) {
    return { learningEntryId: null, created: false, reason: "assumption-not-found" };
  }
  const a = rows[0];
  if (a.status !== "validated" && a.status !== "invalidated") {
    return { learningEntryId: null, created: false, reason: "not-tested-yet" };
  }

  let entryType: "mistake" | "insight" | "correction" = "insight";
  let severity: "low" | "medium" | "high" = "low";
  if (a.status === "invalidated") {
    if (a.impact === "critical") {
      entryType = "mistake";
      severity = "high";
    } else if (a.impact === "high") {
      entryType = "mistake";
      severity = "medium";
    } else {
      entryType = "correction";
      severity = "medium";
    }
  }

  const title = `Assumption ${a.status}: "${a.statement.slice(0, 100)}"`;
  const content = [
    `Statement:      ${a.statement}`,
    `Impact:         ${a.impact}`,
    `Final result:   ${a.status}`,
    `Final evidence: ${a.evidenceText ?? "(none)"}`,
  ].join("\n");

  let lesson: string;
  if (entryType === "mistake") {
    lesson = `A ${a.impact}-impact assumption was invalidated. Assumptions of this kind are more fragile than they look; add earlier testing to future work.`;
  } else if (entryType === "correction") {
    lesson = `Assumption was invalidated but impact was bounded. Note the specific pattern so similar assumptions can be flagged earlier next time.`;
  } else {
    lesson = `Assumption validated. Reinforces the underlying belief — but watch for future contexts where the same statement might not hold.`;
  }

  const context = encodeSource({
    source: "retrospective",
    kind: "assumption_test",
    targetId: assumptionId,
  });

  const ins = db
    .insert(learningEntries)
    .values({
      entryType,
      title,
      content,
      lesson,
      context,
      severity,
      tags: JSON.stringify(["auto-retrospective", "assumption"]),
    })
    .returning({ id: learningEntries.id })
    .all();

  return { learningEntryId: ins[0].id, created: true };
}

// ============================================================
// Idea lineage
// ============================================================

export interface IdeaLineage {
  idea: {
    id: string;
    title: string;
    oneLiner: string;
    status: string;
    domain: string | null;
    createdAt: string;
    updatedAt: string;
    tags: string[];
  };
  parent: { id: string; title: string; mutationAxis: string | null } | null;
  variants: Array<{
    id: string;
    title: string;
    mutationAxis: string | null;
    mutationDepth: number;
  }>;
  scores: Array<{
    id: string;
    composite: number;
    scoreType: string;
    createdAt: string;
  }>;
  critique: {
    id: string;
    overallVerdict: string | null;
    verdictReasoning: string | null;
    findings: {
      wrapperProblem: string | null;
      existingProducts: string | null;
      fragileDependencies: string | null;
      vagueStatement: string | null;
      violatesSoftwareOnly: boolean;
    };
  } | null;
  spawnedAssumptions: Array<{
    id: string;
    statement: string;
    impact: string;
    status: string;
    confidence: number;
  }>;
  trackedHypothesis: {
    id: string;
    title: string;
    confidence: number;
    status: string;
    evidenceCount: number;
    resolution: string | null;
  } | null;
  decisionAppearances: Array<{
    decisionId: string;
    decisionTitle: string;
    decisionStatus: string;
    optionId: string;
  }>;
  fermentationAlerts: Array<{
    id: string;
    alertType: string;
    delta: number;
    triggeredAt: string;
    acknowledgedAt: string | null;
  }>;
}

function tagsForIdea(ideaId: string): string[] {
  const rows = db
    .select({ name: tagsTable.name })
    .from(ideaTags)
    .innerJoin(tagsTable, eq(ideaTags.tagId, tagsTable.id))
    .where(eq(ideaTags.ideaId, ideaId))
    .all();
  return rows.map((r) => r.name);
}

/**
 * Walk every cross-module link for an idea and return the full story in
 * one call. Read-only. Returns null if the idea does not exist.
 */
export function getIdeaLineage(ideaId: string): IdeaLineage | null {
  const ideaRows = db.select().from(ideas).where(eq(ideas.id, ideaId)).all();
  if (ideaRows.length === 0) return null;
  const idea = ideaRows[0];

  // Parent (if this idea is a mutation variant)
  const parentLink = db
    .select()
    .from(ideaVariants)
    .where(eq(ideaVariants.ideaId, ideaId))
    .all();
  let parent: IdeaLineage["parent"] = null;
  if (parentLink.length > 0) {
    const parentIdeaRow = db
      .select({ id: ideas.id, title: ideas.title })
      .from(ideas)
      .where(eq(ideas.id, parentLink[0].parentId))
      .all();
    if (parentIdeaRow.length > 0) {
      parent = {
        id: parentIdeaRow[0].id,
        title: parentIdeaRow[0].title,
        mutationAxis: parentLink[0].mutationAxis,
      };
    }
  }

  // Variants (this idea is a parent)
  const childLinks = db
    .select()
    .from(ideaVariants)
    .where(eq(ideaVariants.parentId, ideaId))
    .all();
  const variants: IdeaLineage["variants"] = [];
  for (const v of childLinks) {
    const child = db
      .select({ id: ideas.id, title: ideas.title })
      .from(ideas)
      .where(eq(ideas.id, v.ideaId))
      .all();
    if (child.length > 0) {
      variants.push({
        id: child[0].id,
        title: child[0].title,
        mutationAxis: v.mutationAxis,
        mutationDepth: v.mutationDepth,
      });
    }
  }

  // Scores history
  const scoreRows = db
    .select({
      id: scores.id,
      composite: scores.composite,
      scoreType: scores.scoreType,
      createdAt: scores.createdAt,
    })
    .from(scores)
    .where(eq(scores.ideaId, ideaId))
    .all()
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));

  // Latest critique (there can be multiple; take most recent)
  const critiqueRows = db
    .select()
    .from(critiques)
    .where(eq(critiques.ideaId, ideaId))
    .all()
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const critique = critiqueRows[0]
    ? {
        id: critiqueRows[0].id,
        overallVerdict: critiqueRows[0].overallVerdict,
        verdictReasoning: critiqueRows[0].verdictReasoning,
        findings: {
          wrapperProblem: critiqueRows[0].wrapperProblem,
          existingProducts: critiqueRows[0].existingProducts,
          fragileDependencies: critiqueRows[0].fragileDependencies,
          vagueStatement: critiqueRows[0].vagueStatement,
          violatesSoftwareOnly: critiqueRows[0].violatesSoftwareOnly === "yes",
        },
      }
    : null;

  // Assumptions auto-spawned for this idea
  const ideaMarker = `"ideaId":"${ideaId}"`;
  const spawnedAssumptionRows = db
    .select()
    .from(assumptions)
    .where(like(assumptions.context, `%${ideaMarker}%`))
    .all();
  const spawnedAssumptions = spawnedAssumptionRows.map((a) => ({
    id: a.id,
    statement: a.statement,
    impact: a.impact,
    status: a.status,
    confidence: a.confidence,
  }));

  // Hypothesis tracked for this idea
  const hypRows = db
    .select()
    .from(hypotheses)
    .where(like(hypotheses.context, `%${ideaMarker}%`))
    .all();
  let trackedHypothesis: IdeaLineage["trackedHypothesis"] = null;
  if (hypRows.length > 0) {
    const h = hypRows[0];
    const evCount = db
      .select({ id: evidence.id })
      .from(evidence)
      .where(eq(evidence.hypothesisId, h.id))
      .all().length;
    trackedHypothesis = {
      id: h.id,
      title: h.title,
      confidence: h.confidence ?? 0.5,
      status: h.status ?? "active",
      evidenceCount: evCount,
      resolution: h.resolution ?? null,
    };
  }

  // Decision options seeded from this idea (description contains idea marker)
  const optionRows = db
    .select()
    .from(decisionOptions)
    .where(like(decisionOptions.description, `%ideaId=${ideaId}%`))
    .all();
  const decisionAppearances: IdeaLineage["decisionAppearances"] = [];
  for (const opt of optionRows) {
    const decRow = db
      .select({ id: decisions.id, title: decisions.title, status: decisions.status })
      .from(decisions)
      .where(eq(decisions.id, opt.decisionId))
      .all();
    if (decRow.length > 0) {
      decisionAppearances.push({
        decisionId: decRow[0].id,
        decisionTitle: decRow[0].title,
        decisionStatus: decRow[0].status,
        optionId: opt.id,
      });
    }
  }

  // Fermentation alerts
  const alertRows = db
    .select()
    .from(fermentationAlerts)
    .where(eq(fermentationAlerts.ideaId, ideaId))
    .all();
  const ferms = alertRows.map((a) => ({
    id: a.id,
    alertType: a.alertType,
    delta: a.delta,
    triggeredAt: a.triggeredAt,
    acknowledgedAt: a.acknowledgedAt,
  }));

  return {
    idea: {
      id: idea.id,
      title: idea.title,
      oneLiner: idea.oneLiner,
      status: idea.status,
      domain: idea.domain,
      createdAt: idea.createdAt,
      updatedAt: idea.updatedAt,
      tags: tagsForIdea(ideaId),
    },
    parent,
    variants,
    scores: scoreRows.map((s) => ({
      id: s.id,
      composite: s.composite,
      scoreType: s.scoreType,
      createdAt: s.createdAt ?? "",
    })),
    critique,
    spawnedAssumptions,
    trackedHypothesis,
    decisionAppearances,
    fermentationAlerts: ferms,
  };
}


import { describe, expect, test, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db, sqlite } from "../src/db/client.js";
import {
  ideas,
  scores,
  hypotheses,
  assumptions,
  beliefs,
  contradictions,
  decisions,
  decisionOptions,
  fermentationAlerts,
  critiques,
  confidenceHistory,
  evidence,
} from "../src/db/schema.js";
import {
  trackIdeaAsHypothesis,
  spawnAssumptionsFromCritique,
  createDecisionFromShortlist,
  suggestNextAction,
  parseSource,
  retrospectiveForHypothesis,
  retrospectiveForAssumption,
  getIdeaLineage,
} from "../src/modules/integrations/services.js";
import { learningEntries, ideaVariants } from "../src/db/schema.js";

function resetDb(): void {
  // Order matters: child tables first to respect FKs, then parents.
  sqlite.exec(`
    DELETE FROM decision_ratings;
    DELETE FROM decision_options;
    DELETE FROM decision_criteria;
    DELETE FROM decisions;
    DELETE FROM confidence_history;
    DELETE FROM evidence;
    DELETE FROM hypotheses;
    DELETE FROM assumptions;
    DELETE FROM contradictions;
    DELETE FROM beliefs;
    DELETE FROM fermentation_alerts;
    DELETE FROM critiques;
    DELETE FROM scores;
    DELETE FROM idea_tags;
    DELETE FROM idea_variants;
    DELETE FROM idea_runs;
    DELETE FROM rejection_patterns;
    DELETE FROM ideas;
    DELETE FROM tags;
    DELETE FROM learning_entries;
    DELETE FROM argument_nodes;
    DELETE FROM arguments;
    DELETE FROM mental_model_applications;
  `);
}

function seedIdea(title: string, composite: number, status = "raw") {
  const ideaRow = db
    .insert(ideas)
    .values({
      title,
      oneLiner: `One-liner for ${title}`,
      problem: `Problem ${title}`,
      solution: `Solution ${title}`,
      status,
    })
    .returning({ id: ideas.id })
    .all()[0];

  db.insert(scores)
    .values({
      ideaId: ideaRow.id,
      novelty: composite,
      usefulness: composite,
      feasibility: composite,
      testability: composite,
      speedToMvp: composite,
      defensibility: composite,
      clarity: composite,
      composite,
    })
    .run();

  return ideaRow.id;
}

describe("trackIdeaAsHypothesis", () => {
  beforeEach(resetDb);

  test("creates hypothesis seeded at composite/10", () => {
    const ideaId = seedIdea("Widget", 7.5);

    const link = trackIdeaAsHypothesis(ideaId);

    expect(link).not.toBeNull();
    expect(link!.created).toBe(true);
    expect(link!.initialConfidence).toBeCloseTo(0.75, 5);
    expect(link!.ideaId).toBe(ideaId);

    const row = db
      .select()
      .from(hypotheses)
      .where(eq(hypotheses.id, link!.hypothesisId))
      .all()[0];
    expect(row.title).toContain("Widget");
    const src = parseSource(row.context);
    expect(src?.source).toBe("idea_lab");
    expect(src?.ideaId).toBe(ideaId);
  });

  test("is idempotent on the same idea", () => {
    const ideaId = seedIdea("Repeated", 6.0);
    const first = trackIdeaAsHypothesis(ideaId);
    const second = trackIdeaAsHypothesis(ideaId);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.hypothesisId).toBe(second!.hypothesisId);
    expect(second!.created).toBe(false);

    const allHypotheses = db.select().from(hypotheses).all();
    expect(allHypotheses.length).toBe(1);
  });

  test("returns null when idea has no score", () => {
    const ideaRow = db
      .insert(ideas)
      .values({
        title: "Unscored",
        oneLiner: "no score",
        problem: "p",
        solution: "s",
      })
      .returning({ id: ideas.id })
      .all()[0];

    const link = trackIdeaAsHypothesis(ideaRow.id);
    expect(link).toBeNull();
  });

  test("clamps confidence into [0.01, 0.99]", () => {
    const highId = seedIdea("Perfect", 10);
    const high = trackIdeaAsHypothesis(highId);
    expect(high!.initialConfidence).toBeLessThanOrEqual(0.99);
    expect(high!.initialConfidence).toBeGreaterThan(0.9);

    const lowId = seedIdea("Awful", 0);
    const low = trackIdeaAsHypothesis(lowId);
    expect(low!.initialConfidence).toBeGreaterThanOrEqual(0.01);
  });
});

describe("spawnAssumptionsFromCritique", () => {
  beforeEach(resetDb);

  test("creates assumptions for fragile deps and existing products", () => {
    const ideaId = seedIdea("HasCritique", 7);

    const result = spawnAssumptionsFromCritique(ideaId, {
      wrapperProblem: null,
      existingProducts: "Competitor X at example.com",
      fragileDependencies: "Relies on OpenAI API",
      vagueStatement: null,
      violatesSoftwareOnly: false,
      overallVerdict: "weak",
      verdictReasoning: "Has concerns",
    });

    expect(result.assumptions).toHaveLength(2);
    expect(result.skipped).toBe(0);

    const kinds = result.assumptions.map((a) =>
      a.statement.includes("OpenAI") ? "dep" : "compete",
    );
    expect(kinds.sort()).toEqual(["compete", "dep"]);

    const rows = db.select().from(assumptions).all();
    expect(rows).toHaveLength(2);
    const impacts = rows.map((r) => r.impact).sort();
    expect(impacts).toEqual(["critical", "high"]);
  });

  test("is idempotent per idea+kind", () => {
    const ideaId = seedIdea("Dup", 6);
    const findings = {
      wrapperProblem: null,
      existingProducts: "X",
      fragileDependencies: "Y",
      vagueStatement: null,
      violatesSoftwareOnly: false,
      overallVerdict: "weak" as const,
      verdictReasoning: "",
    };

    const first = spawnAssumptionsFromCritique(ideaId, findings);
    const second = spawnAssumptionsFromCritique(ideaId, findings);

    expect(first.assumptions).toHaveLength(2);
    expect(second.assumptions).toHaveLength(0);
    expect(second.skipped).toBe(2);
    expect(db.select().from(assumptions).all()).toHaveLength(2);
  });

  test("skips findings that are null", () => {
    const ideaId = seedIdea("Partial", 6);
    const result = spawnAssumptionsFromCritique(ideaId, {
      wrapperProblem: null,
      existingProducts: null,
      fragileDependencies: "Something fragile",
      vagueStatement: null,
      violatesSoftwareOnly: false,
      overallVerdict: "pass",
      verdictReasoning: "",
    });

    expect(result.assumptions).toHaveLength(1);
    expect(result.assumptions[0].impact).toBe("high");
  });
});

describe("createDecisionFromShortlist", () => {
  beforeEach(resetDb);

  test("pulls every shortlisted idea when no ids given", () => {
    const a = seedIdea("A", 7, "shortlisted");
    const b = seedIdea("B", 8, "shortlisted");
    seedIdea("C", 5, "raw"); // should be ignored

    const result = createDecisionFromShortlist("Which to build?", undefined, undefined);

    expect(result.optionCount).toBe(2);
    expect(result.seededIdeaIds.sort()).toEqual([a, b].sort());

    const opts = db
      .select()
      .from(decisionOptions)
      .all();
    expect(opts).toHaveLength(2);
    expect(opts.every((o) => o.description?.includes("[source: idea_lab"))).toBe(true);
  });

  test("respects explicit idea_ids override", () => {
    const a = seedIdea("A", 7, "shortlisted");
    seedIdea("B", 8, "shortlisted");

    const result = createDecisionFromShortlist("Pick", undefined, [a]);
    expect(result.optionCount).toBe(1);
    expect(result.seededIdeaIds).toEqual([a]);
  });

  test("throws when no shortlisted ideas exist and no ids given", () => {
    seedIdea("Only raw", 5, "raw");
    expect(() =>
      createDecisionFromShortlist("Pick", undefined, undefined),
    ).toThrow(/No shortlisted ideas/);
  });
});

describe("suggestNextAction", () => {
  beforeEach(resetDb);

  test("returns empty suggestions on a clean db", () => {
    const result = suggestNextAction();
    expect(result.suggestions).toHaveLength(0);
    expect(result.stateSummary.activeHypotheses).toBe(0);
  });

  test("surfaces critical untested assumptions first", () => {
    db.insert(assumptions)
      .values([
        { statement: "minor thing", impact: "low", status: "untested" },
        { statement: "KEY assumption", impact: "critical", status: "untested" },
      ])
      .run();

    const result = suggestNextAction();
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions[0].category).toBe("untested_critical_assumption");
    expect(result.stateSummary.untestedCritical).toBe(1);
  });

  test("suggests a decision when >=2 shortlisted ideas and no open decision", () => {
    seedIdea("X", 7, "shortlisted");
    seedIdea("Y", 8, "shortlisted");

    const result = suggestNextAction();
    const shortlistSug = result.suggestions.find(
      (s) => s.category === "shortlist_ready_for_decision",
    );
    expect(shortlistSug).toBeDefined();
    expect(shortlistSug!.recommendedTool).toBe("decision_create_from_shortlist");
    expect(result.stateSummary.shortlistedIdeas).toBe(2);
  });

  test("does not suggest decision if an open decision already exists", () => {
    seedIdea("X", 7, "shortlisted");
    seedIdea("Y", 8, "shortlisted");
    db.insert(decisions)
      .values({ title: "already open", status: "open" })
      .run();

    const result = suggestNextAction();
    const shortlistSug = result.suggestions.find(
      (s) => s.category === "shortlist_ready_for_decision",
    );
    expect(shortlistSug).toBeUndefined();
  });

  test("respects maxSuggestions", () => {
    db.insert(assumptions)
      .values(
        Array.from({ length: 10 }, (_, i) => ({
          statement: `a${i}`,
          impact: "critical",
          status: "untested",
        })),
      )
      .run();

    const result = suggestNextAction(2);
    expect(result.suggestions).toHaveLength(2);
  });
});

describe("end-to-end: idea pipeline feeds cross-module state", () => {
  beforeEach(resetDb);

  test("promote->hypothesis + critique->assumption flow", () => {
    const ideaId = seedIdea("Pipeline", 8.2, "raw");

    // Simulate critique
    db.insert(critiques)
      .values({
        ideaId,
        content: "stub",
        existingProducts: "ExistingCo",
        fragileDependencies: "SomeAPI",
        overallVerdict: "weak",
      })
      .run();

    const spawn = spawnAssumptionsFromCritique(ideaId, {
      wrapperProblem: null,
      existingProducts: "ExistingCo",
      fragileDependencies: "SomeAPI",
      vagueStatement: null,
      violatesSoftwareOnly: false,
      overallVerdict: "weak",
      verdictReasoning: "",
    });
    expect(spawn.assumptions).toHaveLength(2);

    // Promote
    db.update(ideas)
      .set({ status: "shortlisted" })
      .where(eq(ideas.id, ideaId))
      .run();
    const track = trackIdeaAsHypothesis(ideaId);
    expect(track).not.toBeNull();
    expect(track!.initialConfidence).toBeCloseTo(0.82, 5);

    // Now suggest_next_action should surface the critical assumption
    const suggestions = suggestNextAction();
    const criticalSug = suggestions.suggestions.find(
      (s) => s.category === "untested_critical_assumption",
    );
    expect(criticalSug).toBeDefined();
    expect(criticalSug!.message).toContain("existing alternatives");
  });
});

describe("retrospectiveForHypothesis", () => {
  beforeEach(resetDb);

  test("classifies high-confidence rejection as a mistake", () => {
    const ideaId = seedIdea("Overconfident", 9);
    const link = trackIdeaAsHypothesis(ideaId)!;

    db.update(hypotheses)
      .set({
        status: "rejected",
        resolution: "rejected",
        confidence: 0.05,
        finalEvidence: "Fell over in production",
      })
      .where(eq(hypotheses.id, link.hypothesisId))
      .run();

    const result = retrospectiveForHypothesis(link.hypothesisId);
    expect(result.created).toBe(true);

    const entry = db
      .select()
      .from(learningEntries)
      .where(eq(learningEntries.id, result.learningEntryId!))
      .all()[0];
    expect(entry.entryType).toBe("mistake");
    expect(entry.severity).toBe("high");
    expect(entry.content).toContain("Initial confidence: 0.90");
    expect(entry.lesson).toContain("high confidence");
  });

  test("classifies low-confidence confirmation as a surprise", () => {
    const ideaId = seedIdea("Underrated", 2);
    const link = trackIdeaAsHypothesis(ideaId)!;

    db.update(hypotheses)
      .set({
        status: "confirmed",
        resolution: "confirmed",
        confidence: 0.95,
        finalEvidence: "Users loved it",
      })
      .where(eq(hypotheses.id, link.hypothesisId))
      .run();

    const result = retrospectiveForHypothesis(link.hypothesisId);
    expect(result.created).toBe(true);

    const entry = db
      .select()
      .from(learningEntries)
      .where(eq(learningEntries.id, result.learningEntryId!))
      .all()[0];
    expect(entry.entryType).toBe("surprise");
  });

  test("is idempotent per hypothesis", () => {
    const ideaId = seedIdea("Dup", 5);
    const link = trackIdeaAsHypothesis(ideaId)!;
    db.update(hypotheses)
      .set({
        status: "confirmed",
        resolution: "confirmed",
        confidence: 0.9,
        finalEvidence: "ok",
      })
      .where(eq(hypotheses.id, link.hypothesisId))
      .run();

    const first = retrospectiveForHypothesis(link.hypothesisId);
    const second = retrospectiveForHypothesis(link.hypothesisId);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.reason).toBe("already-recorded");
    expect(db.select().from(learningEntries).all()).toHaveLength(1);
  });

  test("refuses to record an unresolved hypothesis", () => {
    const ideaId = seedIdea("Active", 5);
    const link = trackIdeaAsHypothesis(ideaId)!;

    const result = retrospectiveForHypothesis(link.hypothesisId);
    expect(result.created).toBe(false);
    expect(result.reason).toBe("not-resolved-yet");
  });
});

describe("retrospectiveForAssumption", () => {
  beforeEach(resetDb);

  test("classifies critical invalidation as high-severity mistake", () => {
    const rows = db
      .insert(assumptions)
      .values({
        statement: "Users will pay",
        impact: "critical",
        status: "invalidated",
        confidence: 0.2,
        evidenceText: "No one converted",
        testedAt: new Date().toISOString(),
      })
      .returning({ id: assumptions.id })
      .all();

    const result = retrospectiveForAssumption(rows[0].id);
    expect(result.created).toBe(true);

    const entry = db
      .select()
      .from(learningEntries)
      .where(eq(learningEntries.id, result.learningEntryId!))
      .all()[0];
    expect(entry.entryType).toBe("mistake");
    expect(entry.severity).toBe("high");
  });

  test("classifies validation as an insight", () => {
    const rows = db
      .insert(assumptions)
      .values({
        statement: "Docs can be auto-generated",
        impact: "medium",
        status: "validated",
        confidence: 0.9,
        evidenceText: "Prototype worked",
        testedAt: new Date().toISOString(),
      })
      .returning({ id: assumptions.id })
      .all();

    const result = retrospectiveForAssumption(rows[0].id);
    expect(result.created).toBe(true);
    const entry = db
      .select()
      .from(learningEntries)
      .where(eq(learningEntries.id, result.learningEntryId!))
      .all()[0];
    expect(entry.entryType).toBe("insight");
    expect(entry.severity).toBe("low");
  });

  test("refuses untested assumption", () => {
    const rows = db
      .insert(assumptions)
      .values({
        statement: "untested",
        impact: "low",
        status: "untested",
        confidence: 0.5,
      })
      .returning({ id: assumptions.id })
      .all();
    const result = retrospectiveForAssumption(rows[0].id);
    expect(result.created).toBe(false);
    expect(result.reason).toBe("not-tested-yet");
  });
});

describe("getIdeaLineage", () => {
  beforeEach(resetDb);

  test("returns null for unknown idea", () => {
    expect(getIdeaLineage("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  test("assembles a full trail from critique, spawn, promote, and decision", () => {
    const ideaId = seedIdea("Lineage", 7.5, "shortlisted");

    // Critique + auto-spawn assumptions
    db.insert(critiques)
      .values({
        ideaId,
        content: "stub",
        existingProducts: "Rival",
        fragileDependencies: "ExtAPI",
        overallVerdict: "weak",
        verdictReasoning: "meh",
      })
      .run();
    spawnAssumptionsFromCritique(ideaId, {
      wrapperProblem: null,
      existingProducts: "Rival",
      fragileDependencies: "ExtAPI",
      vagueStatement: null,
      violatesSoftwareOnly: false,
      overallVerdict: "weak",
      verdictReasoning: "",
    });

    // Promote -> hypothesis
    trackIdeaAsHypothesis(ideaId);

    // Decision seeded
    createDecisionFromShortlist("Which to build?", undefined, [ideaId]);

    const lineage = getIdeaLineage(ideaId)!;
    expect(lineage.idea.title).toBe("Lineage");
    expect(lineage.scores).toHaveLength(1);
    expect(lineage.critique?.overallVerdict).toBe("weak");
    expect(lineage.spawnedAssumptions).toHaveLength(2);
    expect(lineage.trackedHypothesis).not.toBeNull();
    expect(lineage.trackedHypothesis!.confidence).toBeCloseTo(0.75, 5);
    expect(lineage.decisionAppearances).toHaveLength(1);
    expect(lineage.decisionAppearances[0].decisionTitle).toBe("Which to build?");
  });

  test("surfaces parent and variants", () => {
    const parentId = seedIdea("Parent", 6);
    const childId = seedIdea("Child", 5);
    db.insert(ideaVariants)
      .values({
        parentId,
        ideaId: childId,
        mutationAxis: "target_user",
        mutationDepth: 1,
      })
      .run();

    const parent = getIdeaLineage(parentId)!;
    expect(parent.variants).toHaveLength(1);
    expect(parent.variants[0].title).toBe("Child");
    expect(parent.variants[0].mutationAxis).toBe("target_user");

    const child = getIdeaLineage(childId)!;
    expect(child.parent).not.toBeNull();
    expect(child.parent!.title).toBe("Parent");
  });
});

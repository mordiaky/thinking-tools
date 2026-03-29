import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
} from "drizzle-orm/sqlite-core";

// ============================================================
// IDEA LAB MODULE
// ============================================================

export const ideas = sqliteTable("ideas", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  oneLiner: text("one_liner").notNull(),
  problem: text("problem").notNull(),
  solution: text("solution").notNull(),
  whyNow: text("why_now"),
  targetUser: text("target_user"),
  constraints: text("constraints"),
  risks: text("risks"),
  mvpSteps: text("mvp_steps"),
  domain: text("domain"),
  status: text("status").notNull().default("raw"), // 'raw' | 'shortlisted' | 'build-next' | 'rejected'
  reValidatedAt: text("re_validated_at"),
  lastScoredAt: text("last_scored_at"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const scores = sqliteTable("scores", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  ideaId: text("idea_id")
    .notNull()
    .references(() => ideas.id, { onDelete: "cascade" }),
  novelty: real("novelty").notNull(),
  usefulness: real("usefulness").notNull(),
  feasibility: real("feasibility").notNull(),
  testability: real("testability").notNull(),
  speedToMvp: real("speed_to_mvp").notNull(),
  defensibility: real("defensibility").notNull(),
  clarity: real("clarity").notNull(),
  composite: real("composite").notNull(),
  noveltyReasoning: text("novelty_reasoning"),
  usefulnessReasoning: text("usefulness_reasoning"),
  feasibilityReasoning: text("feasibility_reasoning"),
  testabilityReasoning: text("testability_reasoning"),
  speedToMvpReasoning: text("speed_to_mvp_reasoning"),
  defensibilityReasoning: text("defensibility_reasoning"),
  clarityReasoning: text("clarity_reasoning"),
  scoreType: text("score_type").notNull().default("initial"), // 'initial' | 'rescore'
  marketContext: text("market_context"),
  rubricSnapshot: text("rubric_snapshot"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const critiques = sqliteTable("critiques", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  ideaId: text("idea_id")
    .notNull()
    .references(() => ideas.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  wrapperProblem: text("wrapper_problem"),
  existingProducts: text("existing_products"),
  fragileDependencies: text("fragile_dependencies"),
  vagueStatement: text("vague_statement"),
  violatesSoftwareOnly: text("violates_software_only"),
  overallVerdict: text("overall_verdict"), // 'pass' | 'weak' | 'reject'
  verdictReasoning: text("verdict_reasoning"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const tags = sqliteTable("tags", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const ideaTags = sqliteTable(
  "idea_tags",
  {
    ideaId: text("idea_id")
      .notNull()
      .references(() => ideas.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (ideaTags) => [primaryKey({ columns: [ideaTags.ideaId, ideaTags.tagId] })],
);

export const ideaRuns = sqliteTable("idea_runs", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  domain: text("domain"),
  candidateCount: integer("candidate_count").notNull(),
  passCount: integer("pass_count").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const ideaVariants = sqliteTable("idea_variants", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  parentId: text("parent_id")
    .notNull()
    .references(() => ideas.id, { onDelete: "cascade" }),
  ideaId: text("idea_id")
    .notNull()
    .references(() => ideas.id, { onDelete: "cascade" }),
  mutationAxis: text("mutation_axis"),
  mutationDepth: integer("mutation_depth").notNull().default(1),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const rejectionPatterns = sqliteTable("rejection_patterns", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  patternText: text("pattern_text").notNull().unique(),
  sourceCritiqueId: text("source_critique_id").references(
    () => critiques.id,
    { onDelete: "set null" },
  ),
  frequencyCount: integer("frequency_count").notNull().default(1),
  lastSeen: text("last_seen")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const fermentationAlerts = sqliteTable("fermentation_alerts", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  ideaId: text("idea_id")
    .notNull()
    .references(() => ideas.id, { onDelete: "cascade" }),
  alertType: text("alert_type").notNull(), // 'crossed_threshold' | 'large_positive_delta' | 'large_negative_delta'
  previousComposite: real("previous_composite").notNull(),
  newComposite: real("new_composite").notNull(),
  delta: real("delta").notNull(),
  triggeredAt: text("triggered_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  acknowledgedAt: text("acknowledged_at"), // null = unseen
});

// Idea Lab type exports
export type Idea = typeof ideas.$inferSelect;
export type NewIdea = typeof ideas.$inferInsert;
export type Score = typeof scores.$inferSelect;
export type NewScore = typeof scores.$inferInsert;
export type Critique = typeof critiques.$inferSelect;
export type NewCritique = typeof critiques.$inferInsert;
export type RejectionPattern = typeof rejectionPatterns.$inferSelect;
export type NewRejectionPattern = typeof rejectionPatterns.$inferInsert;
export type FermentationAlert = typeof fermentationAlerts.$inferSelect;
export type NewFermentationAlert = typeof fermentationAlerts.$inferInsert;

// ============================================================
// HYPOTHESIS TRACKER MODULE
// ============================================================

export const hypotheses = sqliteTable("hypotheses", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  confidence: real("confidence").notNull().default(0.5),
  status: text("status").notNull().default("active"), // 'active' | 'confirmed' | 'rejected'
  tags: text("tags").notNull().default("[]"),
  context: text("context"),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
  resolvedAt: text("resolved_at"),
  resolution: text("resolution"), // 'confirmed' | 'rejected' | null
  finalEvidence: text("final_evidence"),
});

export const evidence = sqliteTable("evidence", {
  id: text("id").primaryKey(),
  hypothesisId: text("hypothesis_id")
    .notNull()
    .references(() => hypotheses.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // 'supporting' | 'contradicting' | 'neutral'
  description: text("description").notNull(),
  weight: real("weight").notNull().default(0.5),
  source: text("source"),
  confidenceBefore: real("confidence_before").notNull(),
  confidenceAfter: real("confidence_after").notNull(),
  createdAt: text("created_at"),
});

export const confidenceHistory = sqliteTable("confidence_history", {
  id: text("id").primaryKey(),
  hypothesisId: text("hypothesis_id")
    .notNull()
    .references(() => hypotheses.id, { onDelete: "cascade" }),
  confidence: real("confidence").notNull(),
  reason: text("reason").notNull(),
  createdAt: text("created_at"),
});

// Hypothesis Tracker type exports
export type Hypothesis = typeof hypotheses.$inferSelect;
export type NewHypothesis = typeof hypotheses.$inferInsert;
export type Evidence = typeof evidence.$inferSelect;
export type NewEvidence = typeof evidence.$inferInsert;
export type ConfidenceHistory = typeof confidenceHistory.$inferSelect;
export type NewConfidenceHistory = typeof confidenceHistory.$inferInsert;

// ============================================================
// DECISION MATRIX MODULE
// ============================================================

export const decisions = sqliteTable("decisions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("open"), // 'open' | 'decided' | 'revisited'
  chosenOptionId: text("chosen_option_id"),
  decidedAt: text("decided_at"),
  createdAt: text("created_at")
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .$defaultFn(() => new Date().toISOString()),
});

export const decisionCriteria = sqliteTable("decision_criteria", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  decisionId: text("decision_id")
    .notNull()
    .references(() => decisions.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  weight: real("weight").notNull().default(1.0),
  description: text("description"),
  createdAt: text("created_at")
    .$defaultFn(() => new Date().toISOString()),
});

export const decisionOptions = sqliteTable("decision_options", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  decisionId: text("decision_id")
    .notNull()
    .references(() => decisions.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: text("created_at")
    .$defaultFn(() => new Date().toISOString()),
});

export const decisionRatings = sqliteTable("decision_ratings", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  optionId: text("option_id")
    .notNull()
    .references(() => decisionOptions.id, { onDelete: "cascade" }),
  criterionId: text("criterion_id")
    .notNull()
    .references(() => decisionCriteria.id, { onDelete: "cascade" }),
  score: real("score").notNull(),
  reasoning: text("reasoning"),
  createdAt: text("created_at")
    .$defaultFn(() => new Date().toISOString()),
});

// Decision Matrix type exports
export type Decision = typeof decisions.$inferSelect;
export type NewDecision = typeof decisions.$inferInsert;
export type DecisionCriteria = typeof decisionCriteria.$inferSelect;
export type NewDecisionCriteria = typeof decisionCriteria.$inferInsert;
export type DecisionOption = typeof decisionOptions.$inferSelect;
export type NewDecisionOption = typeof decisionOptions.$inferInsert;
export type DecisionRating = typeof decisionRatings.$inferSelect;
export type NewDecisionRating = typeof decisionRatings.$inferInsert;

// ============================================================
// MENTAL MODELS MODULE
// ============================================================

export const mentalModelApplications = sqliteTable("mental_model_applications", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  modelName: text("model_name").notNull(), // e.g. 'first-principles', 'inversion', 'second-order'
  problem: text("problem").notNull(),
  analysis: text("analysis").notNull(),
  insights: text("insights"),
  createdAt: text("created_at")
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .$defaultFn(() => new Date().toISOString()),
  tags: text("tags").default("[]"),
});

// Mental Models type exports
export type MentalModelApplication = typeof mentalModelApplications.$inferSelect;
export type NewMentalModelApplication = typeof mentalModelApplications.$inferInsert;

// ============================================================
// ASSUMPTION TRACKER MODULE
// ============================================================

export const assumptions = sqliteTable("assumptions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  statement: text("statement").notNull(),
  context: text("context"),
  status: text("status").notNull().default("untested"), // 'untested' | 'testing' | 'validated' | 'invalidated'
  confidence: real("confidence").notNull().default(0.5),
  evidenceText: text("evidence"),
  source: text("source"),
  impact: text("impact").notNull().default("medium"), // 'low' | 'medium' | 'high' | 'critical'
  createdAt: text("created_at")
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .$defaultFn(() => new Date().toISOString()),
  testedAt: text("tested_at"),
  tags: text("tags").default("[]"),
});

// Assumption Tracker type exports
export type Assumption = typeof assumptions.$inferSelect;
export type NewAssumption = typeof assumptions.$inferInsert;

// ============================================================
// CONTRADICTION DETECTOR MODULE
// ============================================================

export const beliefs = sqliteTable("beliefs", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  statement: text("statement").notNull(),
  domain: text("domain"),
  confidence: real("confidence").notNull().default(0.5),
  source: text("source"),
  createdAt: text("created_at")
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .$defaultFn(() => new Date().toISOString()),
  tags: text("tags").default("[]"),
});

export const contradictions = sqliteTable("contradictions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  beliefAId: text("belief_a_id")
    .notNull()
    .references(() => beliefs.id, { onDelete: "cascade" }),
  beliefBId: text("belief_b_id")
    .notNull()
    .references(() => beliefs.id, { onDelete: "cascade" }),
  explanation: text("explanation").notNull(),
  status: text("status").notNull().default("unresolved"), // 'unresolved' | 'resolved' | 'accepted'
  resolution: text("resolution"),
  createdAt: text("created_at")
    .$defaultFn(() => new Date().toISOString()),
  resolvedAt: text("resolved_at"),
});

// Contradiction Detector type exports
export type Belief = typeof beliefs.$inferSelect;
export type NewBelief = typeof beliefs.$inferInsert;
export type Contradiction = typeof contradictions.$inferSelect;
export type NewContradiction = typeof contradictions.$inferInsert;

// ============================================================
// LEARNING JOURNAL MODULE
// ============================================================

export const learningEntries = sqliteTable("learning_entries", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  entryType: text("entry_type").notNull(), // 'mistake' | 'insight' | 'surprise' | 'pattern' | 'correction'
  title: text("title").notNull(),
  content: text("content").notNull(),
  lesson: text("lesson"),
  context: text("context"),
  severity: text("severity").default("medium"), // 'low' | 'medium' | 'high'
  createdAt: text("created_at")
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .$defaultFn(() => new Date().toISOString()),
  tags: text("tags").default("[]"),
});

// Learning Journal type exports
export type LearningEntry = typeof learningEntries.$inferSelect;
export type NewLearningEntry = typeof learningEntries.$inferInsert;

// ============================================================
// ARGUMENT MAPPER MODULE
// ============================================================

export const arguments_ = sqliteTable("arguments", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  topic: text("topic").notNull(),
  conclusion: text("conclusion"),
  status: text("status").notNull().default("building"), // 'building' | 'complete' | 'challenged'
  createdAt: text("created_at")
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .$defaultFn(() => new Date().toISOString()),
  tags: text("tags").default("[]"),
});

export const argumentNodes = sqliteTable("argument_nodes", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  argumentId: text("argument_id")
    .notNull()
    .references(() => arguments_.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // 'claim' | 'evidence' | 'rebuttal' | 'qualifier' | 'counter'
  content: text("content").notNull(),
  parentNodeId: text("parent_node_id"), // self-referential FK — cannot use .references() for self-ref in drizzle easily, handled at DB level
  strength: text("strength").default("medium"), // 'weak' | 'medium' | 'strong'
  source: text("source"),
  createdAt: text("created_at")
    .$defaultFn(() => new Date().toISOString()),
});

// Argument Mapper type exports
export type Argument = typeof arguments_.$inferSelect;
export type NewArgument = typeof arguments_.$inferInsert;
export type ArgumentNode = typeof argumentNodes.$inferSelect;
export type NewArgumentNode = typeof argumentNodes.$inferInsert;

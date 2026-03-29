import { db } from "../../../db/client.js";
import { ideas, critiques, tags, ideaTags } from "../../../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { getMutationContext, recordMutation, getIdeaLatestScore } from "./mutation.js";

const REFINEMENT_CONSTRAINTS = [
  {
    id: "weekend-buildable",
    label: "Weekend-buildable",
    description: "Must be fully buildable in a single weekend by one developer",
  },
  {
    id: "cli-only",
    label: "CLI only",
    description: "No GUI, no web UI — CLI interface only",
  },
  {
    id: "offline-only",
    label: "Offline only",
    description: "Must work fully offline, no network calls",
  },
  {
    id: "single-user-type",
    label: "Single user type",
    description: "Serve exactly one user archetype, not multiple",
  },
  {
    id: "no-dependencies",
    label: "No dependencies",
    description: "Zero runtime dependencies — stdlib only",
  },
  {
    id: "api-only",
    label: "API only",
    description: "Headless API/service — no end-user interface",
  },
];

export interface RefinementContext {
  idea: {
    id: string;
    title: string;
    oneLiner: string;
    problem: string;
    solution: string;
    whyNow: string | null;
    targetUser: string | null;
    constraints: string | null;
    risks: string | null;
    domain: string | null;
    status: string;
  };
  critique: {
    content: string;
    wrapperProblem: string | null;
    existingProducts: string | null;
    fragileDependencies: string | null;
    vagueStatement: string | null;
    overallVerdict: string | null;
    verdictReasoning: string | null;
  } | null;
  score: { composite: number } | null;
  constraints: typeof REFINEMENT_CONSTRAINTS;
  currentDepth: number;
  instructions: string;
}

/**
 * Returns idea content, latest critique, latest score, constraint menu, and
 * instructions for the caller to pick a constraint and generate a refined variant.
 */
export async function getRefinementContext(
  ideaId: string,
): Promise<RefinementContext | { error: string }> {
  // Fetch the idea
  const ideaRows = await db
    .select({
      id: ideas.id,
      title: ideas.title,
      oneLiner: ideas.oneLiner,
      problem: ideas.problem,
      solution: ideas.solution,
      whyNow: ideas.whyNow,
      targetUser: ideas.targetUser,
      constraints: ideas.constraints,
      risks: ideas.risks,
      domain: ideas.domain,
      status: ideas.status,
    })
    .from(ideas)
    .where(eq(ideas.id, ideaId));

  if (ideaRows.length === 0) {
    return { error: "Idea not found" };
  }

  const idea = ideaRows[0];

  // Check mutation depth cap
  const mutationCtx = await getMutationContext(ideaId);
  if ("error" in mutationCtx) {
    return { error: mutationCtx.error };
  }
  if (!mutationCtx.canMutate) {
    return {
      error: `Refinement depth cap reached (depth ${mutationCtx.currentDepth}). Cannot refine further. Maximum depth is 2.`,
    };
  }

  // Fetch latest critique
  const critiqueRows = await db
    .select({
      content: critiques.content,
      wrapperProblem: critiques.wrapperProblem,
      existingProducts: critiques.existingProducts,
      fragileDependencies: critiques.fragileDependencies,
      vagueStatement: critiques.vagueStatement,
      overallVerdict: critiques.overallVerdict,
      verdictReasoning: critiques.verdictReasoning,
    })
    .from(critiques)
    .where(eq(critiques.ideaId, ideaId))
    .orderBy(desc(critiques.createdAt))
    .limit(1);

  const critique = critiqueRows.length > 0 ? critiqueRows[0] : null;

  // Fetch latest score
  const score = await getIdeaLatestScore(ideaId);

  return {
    idea,
    critique,
    score,
    constraints: REFINEMENT_CONSTRAINTS,
    currentDepth: mutationCtx.currentDepth,
    instructions:
      "Review the critique findings and score above. Pick one constraint from the constraints list that forces a sharper, more focused version of this idea. Generate a refined idea that: (1) directly addresses the critique weaknesses, (2) fully satisfies the chosen constraint. Then call idea_lab_refine_idea again with ideaId, the constraint id, and the new idea fields (title, oneLiner, problem, solution required; whyNow, targetUser, constraints, risks, domain, tags optional).",
  };
}

export interface RefinedVariantResult {
  newIdeaId: string;
  parentId: string;
  constraint: string;
  depth: number;
  nextStep: string;
}

/**
 * Creates a new idea record and links it as a refinement variant of the parent.
 * axis is always "scope" for refinements.
 */
export async function createRefinedVariant(
  parentId: string,
  constraint: string,
  fields: {
    title: string;
    oneLiner: string;
    problem: string;
    solution: string;
    whyNow?: string;
    targetUser?: string;
    constraints?: string;
    risks?: string;
    domain?: string;
    tags?: string[];
  },
): Promise<RefinedVariantResult | { error: string }> {
  // Check depth cap
  const mutationCtx = await getMutationContext(parentId);
  if ("error" in mutationCtx) {
    return { error: mutationCtx.error };
  }
  if (!mutationCtx.canMutate) {
    return {
      error: `Refinement depth cap reached (depth ${mutationCtx.currentDepth}). Cannot create further variants.`,
    };
  }

  const newDepth = mutationCtx.currentDepth + 1;

  // Insert new idea record
  const [inserted] = await db
    .insert(ideas)
    .values({
      title: fields.title,
      oneLiner: fields.oneLiner,
      problem: fields.problem,
      solution: fields.solution,
      whyNow: fields.whyNow,
      targetUser: fields.targetUser,
      constraints: fields.constraints,
      risks: fields.risks,
      domain: fields.domain,
    })
    .returning({ id: ideas.id });

  const newIdeaId = inserted.id;

  // Handle tags if provided
  if (fields.tags && fields.tags.length > 0) {
    for (const tagName of fields.tags) {
      await db.insert(tags).values({ name: tagName }).onConflictDoNothing();
      const [tagRecord] = await db
        .select({ id: tags.id })
        .from(tags)
        .where(eq(tags.name, tagName));
      if (tagRecord) {
        await db.insert(ideaTags).values({ ideaId: newIdeaId, tagId: tagRecord.id }).onConflictDoNothing();
      }
    }
  }

  // Record the mutation relationship — axis is always "scope" for refinements
  await recordMutation(parentId, newIdeaId, "scope", newDepth);

  console.error(`[refinement] Created refined variant: ${parentId} -> ${newIdeaId} constraint="${constraint}" depth=${newDepth}`);

  return {
    newIdeaId,
    parentId,
    constraint,
    depth: newDepth,
    nextStep:
      "Run the full pipeline on the refined idea: call idea_lab_score_idea (read rubric first), then idea_lab_critique_idea, then idea_lab_check_duplicate. After pipeline, promote with idea_lab_promote_idea.",
  };
}

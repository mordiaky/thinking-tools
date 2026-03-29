import { db } from "../../../db/client.js";
import { ideas, tags, ideaTags } from "../../../db/schema.js";
import { eq } from "drizzle-orm";
import { getMutationContext, recordMutation, getIdeaLatestScore } from "./mutation.js";

const DECOMPOSITION_AXES = [
  {
    id: "by-feature",
    label: "By feature",
    description: "Split into discrete, independently useful features",
  },
  {
    id: "by-user-journey",
    label: "By user journey",
    description: "Split by user workflow steps — each micro-idea covers one step",
  },
  {
    id: "by-technical-layer",
    label: "By technical layer",
    description: "Split by backend, frontend, data, or integration layers",
  },
  {
    id: "by-mvp-stage",
    label: "By MVP stage",
    description: "Split into progressive delivery stages — each shippable independently",
  },
];

export interface DecompositionContext {
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
  score: { composite: number } | null;
  currentDepth: number;
  canDecompose: true;
  instructions: string;
  decompositionAxes: typeof DECOMPOSITION_AXES;
}

/**
 * Returns idea content and decomposition guidance.
 * Only works on shortlisted or build-next ideas.
 */
export async function getDecompositionContext(
  ideaId: string,
): Promise<DecompositionContext | { error: string }> {
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

  // Validate status — decomposition only for validated ideas
  if (idea.status !== "shortlisted" && idea.status !== "build-next") {
    return {
      error: `Decomposition requires status 'shortlisted' or 'build-next'. Current status: '${idea.status}'. Promote the idea first with idea_lab_promote_idea.`,
    };
  }

  // Check mutation depth cap
  const mutationCtx = await getMutationContext(ideaId);
  if ("error" in mutationCtx) {
    return { error: mutationCtx.error };
  }
  if (!mutationCtx.canMutate) {
    return {
      error: `Decomposition depth cap reached (depth ${mutationCtx.currentDepth}). Cannot decompose further. Maximum depth is 2.`,
    };
  }

  // Fetch latest score
  const score = await getIdeaLatestScore(ideaId);

  return {
    idea,
    score,
    currentDepth: mutationCtx.currentDepth,
    canDecompose: true,
    instructions:
      "Break this idea into 3-7 independently shippable micro-ideas. Each micro-idea must: (1) solve a distinct sub-problem, (2) be buildable and useful on its own without the other micro-ideas, (3) have clear standalone value. Choose a decomposition axis from decompositionAxes that best fits the idea's structure. Order micro-ideas by priority (most valuable first). Then call idea_lab_decompose_idea again with ideaId and the microIdeas array (each needs title, oneLiner, problem, solution, standaloneValue; domain and tags are optional).",
    decompositionAxes: DECOMPOSITION_AXES,
  };
}

export interface MicroIdeaResult {
  id: string;
  title: string;
  standaloneValue: string;
}

export interface DecompositionResult {
  parentId: string;
  microIdeas: MicroIdeaResult[];
  startHere: {
    id: string;
    title: string;
    reason: string;
  };
  nextStep: string;
}

/**
 * Saves each micro-idea as an idea record and links each as a variant of the parent.
 * standaloneValue is stored in the constraints column as contextual metadata.
 */
export async function saveDecomposition(
  parentId: string,
  microIdeas: Array<{
    title: string;
    oneLiner: string;
    problem: string;
    solution: string;
    standaloneValue: string;
    domain?: string;
    tags?: string[];
  }>,
): Promise<DecompositionResult | { error: string }> {
  // Validate array length
  if (microIdeas.length < 3 || microIdeas.length > 7) {
    return {
      error: `microIdeas must contain 3-7 items. Received: ${microIdeas.length}.`,
    };
  }

  // Check depth cap
  const mutationCtx = await getMutationContext(parentId);
  if ("error" in mutationCtx) {
    return { error: mutationCtx.error };
  }
  if (!mutationCtx.canMutate) {
    return {
      error: `Decomposition depth cap reached (depth ${mutationCtx.currentDepth}). Cannot create further variants.`,
    };
  }

  const newDepth = mutationCtx.currentDepth + 1;
  const savedMicroIdeas: MicroIdeaResult[] = [];

  for (const micro of microIdeas) {
    // Insert micro-idea into ideas table
    // standaloneValue stored in constraints column as contextual metadata
    const [inserted] = await db
      .insert(ideas)
      .values({
        title: micro.title,
        oneLiner: micro.oneLiner,
        problem: micro.problem,
        solution: micro.solution,
        domain: micro.domain,
        constraints: `Standalone value: ${micro.standaloneValue}`,
      })
      .returning({ id: ideas.id });

    const newIdeaId = inserted.id;

    // Handle tags if provided
    if (micro.tags && micro.tags.length > 0) {
      for (const tagName of micro.tags) {
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

    // Link to parent via mutation record — axis is "scope" for decomposition
    await recordMutation(parentId, newIdeaId, "scope", newDepth);

    console.error(`[decomposition] Saved micro-idea: ${parentId} -> ${newIdeaId} depth=${newDepth}`);

    savedMicroIdeas.push({
      id: newIdeaId,
      title: micro.title,
      standaloneValue: micro.standaloneValue,
    });
  }

  // Start here recommendation: first micro-idea in array (caller should order by priority)
  const startHere = {
    id: savedMicroIdeas[0].id,
    title: savedMicroIdeas[0].title,
    reason: "First in priority order — recommended starting point",
  };

  return {
    parentId,
    microIdeas: savedMicroIdeas,
    startHere,
    nextStep:
      "Run the full pipeline on each micro-idea: call idea_lab_score_idea (read rubric first), then idea_lab_critique_idea, then idea_lab_check_duplicate. After pipeline, promote top candidates with idea_lab_promote_idea.",
  };
}

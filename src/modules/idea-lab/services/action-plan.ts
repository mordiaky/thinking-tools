import { db } from "../../../db/client.js";
import { ideas } from "../../../db/schema.js";
import { eq } from "drizzle-orm";

export interface MvpStep {
  stepNumber: number;
  title: string;
  description: string;
  techStack: string[];
  architectureApproach: string;
  timelineEstimate: string;
}

export interface PlanGenerationResult {
  phase: "generate";
  ideaId: string;
  idea: {
    title: string;
    oneLiner: string;
    problem: string;
    solution: string;
    whyNow: string | null;
    targetUser: string | null;
    constraints: string | null;
    risks: string | null;
    domain: string | null;
  };
  instructions: string;
  planSchema: Record<string, string>;
  nextStep: string;
}

/**
 * Fetches an idea for planning (Step 1 of two-step generate_action_plan pattern).
 * Validates that the idea exists, is shortlisted or build-next, and doesn't already have a plan.
 * Returns idea content + format instructions to generate the plan steps.
 */
export async function getIdeaForPlanning(
  ideaId: string,
): Promise<PlanGenerationResult | { error: string }> {
  const rows = await db
    .select()
    .from(ideas)
    .where(eq(ideas.id, ideaId));

  if (rows.length === 0) {
    return { error: "Idea not found" };
  }

  const idea = rows[0];

  if (idea.status !== "shortlisted" && idea.status !== "build-next") {
    return {
      error: `Only shortlisted or build-next ideas can have action plans. Current status: ${idea.status}`,
    };
  }

  if (idea.mvpSteps !== null) {
    return {
      error: "This idea already has an MVP plan. To regenerate, clear it first.",
    };
  }

  return {
    phase: "generate",
    ideaId,
    idea: {
      title: idea.title,
      oneLiner: idea.oneLiner,
      problem: idea.problem,
      solution: idea.solution,
      whyNow: idea.whyNow,
      targetUser: idea.targetUser,
      constraints: idea.constraints,
      risks: idea.risks,
      domain: idea.domain,
    },
    instructions:
      "Generate a 3-5 step MVP action plan for this idea. Each step must include: stepNumber (1-5), title, description (detailed), techStack (array of technologies), architectureApproach, and timelineEstimate. Consider the idea's constraints and risks. Call idea_lab_generate_action_plan again with ideaId and planSteps to save.",
    planSchema: {
      stepNumber: "number (1-5)",
      title: "string",
      description: "string (detailed)",
      techStack: "string[] (technologies)",
      architectureApproach: "string",
      timelineEstimate: "string (e.g., '2-3 days')",
    },
    nextStep:
      "Generate the plan steps and call idea_lab_generate_action_plan with ideaId and planSteps array to persist.",
  };
}

/**
 * Saves a generated MVP plan to the idea record (Step 2 of two-step generate_action_plan pattern).
 * Validates the idea exists and is shortlisted or build-next, then JSON.stringifies the plan steps
 * into the mvpSteps column per D-06.
 */
export async function saveMvpPlan(
  ideaId: string,
  planSteps: MvpStep[],
): Promise<{ saved: boolean; ideaId: string; stepCount: number } | { error: string }> {
  const rows = await db
    .select({ id: ideas.id, status: ideas.status })
    .from(ideas)
    .where(eq(ideas.id, ideaId));

  if (rows.length === 0) {
    return { error: "Idea not found" };
  }

  const idea = rows[0];

  if (idea.status !== "shortlisted" && idea.status !== "build-next") {
    return {
      error: `Only shortlisted or build-next ideas can have action plans. Current status: ${idea.status}`,
    };
  }

  if (planSteps.length < 3 || planSteps.length > 5) {
    return {
      error: `Plan must have 3-5 steps. Received ${planSteps.length} step(s).`,
    };
  }

  await db
    .update(ideas)
    .set({ mvpSteps: JSON.stringify(planSteps), updatedAt: new Date().toISOString() })
    .where(eq(ideas.id, ideaId));

  console.error(`[action-plan] Saved MVP plan for idea ${ideaId} with ${planSteps.length} steps`);

  return { saved: true, ideaId, stepCount: planSteps.length };
}

import { db } from "../../../db/client.js";
import { ideas, ideaVariants, critiques, scores } from "../../../db/schema.js";
import { eq, desc } from "drizzle-orm";

export interface MutationContext {
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
  currentDepth: number;
  canMutate: boolean;
  depthMessage?: string;
}

/**
 * Returns the idea's full content, its latest critique findings, and current mutation depth.
 * Depth is computed by walking the ideaVariants parentId chain (max depth 2).
 */
export async function getMutationContext(
  ideaId: string,
): Promise<MutationContext | { error: string }> {
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

  // Compute mutation depth: check if this idea is a variant (has a parent record)
  let currentDepth = 0;
  let currentId = ideaId;

  for (let i = 0; i < 3; i++) {
    const variantRows = await db
      .select({ parentId: ideaVariants.parentId, mutationDepth: ideaVariants.mutationDepth })
      .from(ideaVariants)
      .where(eq(ideaVariants.ideaId, currentId));

    if (variantRows.length === 0) {
      break;
    }

    currentDepth = variantRows[0].mutationDepth;
    currentId = variantRows[0].parentId;
  }

  const canMutate = currentDepth < 2;
  const depthMessage = canMutate
    ? undefined
    : `Mutation depth cap reached (depth ${currentDepth}). This idea is already a generation-${currentDepth} variant. Maximum depth is 2.`;

  // Fetch the latest critique
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

  return {
    idea,
    critique,
    currentDepth,
    canMutate,
    ...(depthMessage ? { depthMessage } : {}),
  };
}

/**
 * Records a mutation relationship between a parent idea and a child variant idea.
 * Inserts into ideaVariants with mutationAxis and mutationDepth.
 */
export async function recordMutation(
  parentId: string,
  childIdeaId: string,
  axis: string,
  depth: number,
): Promise<{
  id: string;
  parentId: string;
  ideaId: string;
  mutationAxis: string | null;
  mutationDepth: number;
  createdAt: string;
}> {
  const [variant] = await db
    .insert(ideaVariants)
    .values({
      parentId,
      ideaId: childIdeaId,
      mutationAxis: axis,
      mutationDepth: depth,
    })
    .returning({
      id: ideaVariants.id,
      parentId: ideaVariants.parentId,
      ideaId: ideaVariants.ideaId,
      mutationAxis: ideaVariants.mutationAxis,
      mutationDepth: ideaVariants.mutationDepth,
      createdAt: ideaVariants.createdAt,
    });

  console.error(`[mutation] Recorded mutation: ${parentId} -> ${childIdeaId} via axis="${axis}" depth=${depth}`);

  return variant;
}

export interface LineageEntry {
  id: string;
  title: string;
  mutationAxis: string | null;
  mutationDepth: number;
}

export interface IdeaLineage {
  ideaId: string;
  ancestors: LineageEntry[];
  descendants: LineageEntry[];
  depth: number;
}

/**
 * Returns the full lineage tree for an idea.
 * Ancestors: walk parentId up from this idea (what it was mutated from).
 * Descendants: walk ideaId down from this idea (what was mutated from it).
 * Max depth is 2, so iterative lookups are sufficient.
 */
export async function getIdeaLineage(ideaId: string): Promise<IdeaLineage | { error: string }> {
  // Verify idea exists
  const ideaRows = await db
    .select({ id: ideas.id, title: ideas.title })
    .from(ideas)
    .where(eq(ideas.id, ideaId));

  if (ideaRows.length === 0) {
    return { error: "Idea not found" };
  }

  // Walk up to find ancestors
  const ancestors: LineageEntry[] = [];
  let currentId = ideaId;
  let depth = 0;

  for (let i = 0; i < 3; i++) {
    const variantRows = await db
      .select({
        parentId: ideaVariants.parentId,
        mutationAxis: ideaVariants.mutationAxis,
        mutationDepth: ideaVariants.mutationDepth,
      })
      .from(ideaVariants)
      .where(eq(ideaVariants.ideaId, currentId));

    if (variantRows.length === 0) break;

    const variant = variantRows[0];
    depth = variant.mutationDepth;
    currentId = variant.parentId;

    const parentRows = await db
      .select({ id: ideas.id, title: ideas.title })
      .from(ideas)
      .where(eq(ideas.id, currentId));

    if (parentRows.length > 0) {
      ancestors.push({
        id: parentRows[0].id,
        title: parentRows[0].title,
        mutationAxis: variant.mutationAxis,
        mutationDepth: variant.mutationDepth,
      });
    }
  }

  // Walk down to find descendants (ideas that were mutated from this idea)
  const descendants: LineageEntry[] = [];
  const childVariantRows = await db
    .select({
      ideaId: ideaVariants.ideaId,
      mutationAxis: ideaVariants.mutationAxis,
      mutationDepth: ideaVariants.mutationDepth,
    })
    .from(ideaVariants)
    .where(eq(ideaVariants.parentId, ideaId));

  for (const childVariant of childVariantRows) {
    const childRows = await db
      .select({ id: ideas.id, title: ideas.title })
      .from(ideas)
      .where(eq(ideas.id, childVariant.ideaId));

    if (childRows.length > 0) {
      descendants.push({
        id: childRows[0].id,
        title: childRows[0].title,
        mutationAxis: childVariant.mutationAxis,
        mutationDepth: childVariant.mutationDepth,
      });

      // Walk one level deeper (grandchildren)
      const grandchildVariantRows = await db
        .select({
          ideaId: ideaVariants.ideaId,
          mutationAxis: ideaVariants.mutationAxis,
          mutationDepth: ideaVariants.mutationDepth,
        })
        .from(ideaVariants)
        .where(eq(ideaVariants.parentId, childVariant.ideaId));

      for (const gcVariant of grandchildVariantRows) {
        const gcRows = await db
          .select({ id: ideas.id, title: ideas.title })
          .from(ideas)
          .where(eq(ideas.id, gcVariant.ideaId));

        if (gcRows.length > 0) {
          descendants.push({
            id: gcRows[0].id,
            title: gcRows[0].title,
            mutationAxis: gcVariant.mutationAxis,
            mutationDepth: gcVariant.mutationDepth,
          });
        }
      }
    }
  }

  return {
    ideaId,
    ancestors,
    descendants,
    depth,
  };
}

/**
 * Fetches a composite score for an idea (latest score record).
 */
export async function getIdeaLatestScore(ideaId: string): Promise<{
  composite: number;
} | null> {
  const rows = await db
    .select({ composite: scores.composite })
    .from(scores)
    .where(eq(scores.ideaId, ideaId))
    .orderBy(desc(scores.createdAt))
    .limit(1);

  return rows.length > 0 ? rows[0] : null;
}

import { db } from "../../../db/client.js";
import { ideas, scores, ideaTags, tags } from "../../../db/schema.js";
import { and, eq, gte, lte, like, inArray, desc, ne, sql } from "drizzle-orm";

export interface SearchIdeasInput {
  status?: "raw" | "shortlisted" | "build-next" | "rejected";
  domain?: string;
  minScore?: number;
  maxScore?: number;
  tags?: string[];
  after?: string;
  before?: string;
  limit?: number;
  offset?: number;
  semanticQuery?: string;
}

export interface IdeaSummary {
  id: string;
  title: string;
  oneLiner: string;
  status: string;
  domain: string | null;
  composite: number | null;
  createdAt: string;
}

export interface SemanticSummary {
  id: string;
  title: string;
  oneLiner: string;
  problem: string;
  solution: string;
  domain: string | null;
  status: string;
}

/**
 * Search ideas with optional filters. Supports multi-filter queries with
 * tag filtering using a two-step approach (query tag IDs first, then filter ideas).
 */
export async function searchIdeas(input: SearchIdeasInput): Promise<IdeaSummary[]> {
  const conditions = [];

  if (input.status !== undefined) {
    conditions.push(eq(ideas.status, input.status));
  }

  if (input.domain !== undefined) {
    conditions.push(like(ideas.domain, `%${input.domain}%`));
  }

  if (input.minScore !== undefined) {
    conditions.push(gte(scores.composite, input.minScore));
  }

  if (input.maxScore !== undefined) {
    conditions.push(lte(scores.composite, input.maxScore));
  }

  if (input.after !== undefined) {
    conditions.push(gte(ideas.createdAt, new Date(input.after).toISOString()));
  }

  if (input.before !== undefined) {
    conditions.push(lte(ideas.createdAt, new Date(input.before).toISOString()));
  }

  // Two-step tag filtering: query matching idea IDs first
  if (input.tags !== undefined && input.tags.length > 0) {
    const tagRows = await db
      .select({ ideaId: ideaTags.ideaId })
      .from(ideaTags)
      .innerJoin(tags, eq(tags.id, ideaTags.tagId))
      .where(inArray(tags.name, input.tags));

    if (tagRows.length === 0) {
      return [];
    }

    const matchingIdeaIds = tagRows.map((r) => r.ideaId);
    conditions.push(inArray(ideas.id, matchingIdeaIds));
  }

  const rows = await db
    .select({
      id: ideas.id,
      title: ideas.title,
      oneLiner: ideas.oneLiner,
      status: ideas.status,
      domain: ideas.domain,
      composite: scores.composite,
      createdAt: ideas.createdAt,
    })
    .from(ideas)
    .leftJoin(
      scores,
      sql`${scores.id} = (SELECT id FROM scores s2 WHERE s2.idea_id = ${ideas.id} ORDER BY s2.created_at DESC LIMIT 1)`,
    )
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(ideas.createdAt))
    .limit(input.limit ?? 10)
    .offset(input.offset ?? 0);

  return rows;
}

/**
 * Returns ALL ideas with fields needed for semantic search.
 * The caller reads all summaries and judges relevance by conceptual similarity.
 */
export async function getAllIdeaSummaries(): Promise<SemanticSummary[]> {
  return db
    .select({
      id: ideas.id,
      title: ideas.title,
      oneLiner: ideas.oneLiner,
      problem: ideas.problem,
      solution: ideas.solution,
      domain: ideas.domain,
      status: ideas.status,
    })
    .from(ideas);
}

/**
 * Returns recent non-rejected ideas ordered by creation date descending.
 */
export async function getRecentIdeas(limit: number): Promise<IdeaSummary[]> {
  return db
    .select({
      id: ideas.id,
      title: ideas.title,
      oneLiner: ideas.oneLiner,
      status: ideas.status,
      domain: ideas.domain,
      composite: scores.composite,
      createdAt: ideas.createdAt,
    })
    .from(ideas)
    .leftJoin(
      scores,
      sql`${scores.id} = (SELECT id FROM scores s2 WHERE s2.idea_id = ${ideas.id} ORDER BY s2.created_at DESC LIMIT 1)`,
    )
    .where(ne(ideas.status, "rejected"))
    .orderBy(desc(ideas.createdAt))
    .limit(limit);
}

/**
 * Returns top-rated ideas (shortlisted or build-next) ordered by composite score descending.
 * Uses innerJoin to scores since unscored ideas cannot be "top-rated".
 */
export async function getTopRatedIdeas(limit: number): Promise<IdeaSummary[]> {
  return db
    .select({
      id: ideas.id,
      title: ideas.title,
      oneLiner: ideas.oneLiner,
      status: ideas.status,
      domain: ideas.domain,
      composite: scores.composite,
      createdAt: ideas.createdAt,
    })
    .from(ideas)
    .innerJoin(
      scores,
      sql`${scores.id} = (SELECT id FROM scores s2 WHERE s2.idea_id = ${ideas.id} ORDER BY s2.created_at DESC LIMIT 1)`,
    )
    .where(inArray(ideas.status, ["shortlisted", "build-next"]))
    .orderBy(desc(scores.composite))
    .limit(limit);
}

/**
 * Hard-delete a rejected idea and all associated data (scores, critiques, tags).
 * Cascade deletes handle related records. Only rejected ideas may be deleted.
 */
export async function deleteRejectedIdea(
  ideaId: string,
): Promise<{ deleted: boolean; error?: string }> {
  const rows = await db
    .select({ id: ideas.id, status: ideas.status })
    .from(ideas)
    .where(eq(ideas.id, ideaId));

  if (rows.length === 0) {
    return { deleted: false, error: `Idea not found: ${ideaId}` };
  }

  if (rows[0].status !== "rejected") {
    return {
      deleted: false,
      error: "Only rejected ideas can be deleted",
    };
  }

  await db.delete(ideas).where(eq(ideas.id, ideaId));

  return { deleted: true };
}

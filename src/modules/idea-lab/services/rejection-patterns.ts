import { db } from "../../../db/client.js";
import { rejectionPatterns } from "../../../db/schema.js";
import { eq, desc, sql } from "drizzle-orm";

/**
 * Extracts a pattern from verdict reasoning text (first sentence, up to 200 chars)
 * and upserts into rejection_patterns table. On conflict (same pattern_text),
 * increments frequency_count and updates last_seen + source_critique_id.
 */
export async function extractAndUpsertPattern(
  critiqueId: string,
  verdictReasoning: string,
): Promise<{ patternId: string; isNew: boolean }> {
  // Extract first sentence (up to 200 chars) as the canonical pattern text
  const firstSentenceMatch = verdictReasoning.match(/^[^.!?]+[.!?]?/);
  const rawPattern = firstSentenceMatch ? firstSentenceMatch[0].trim() : verdictReasoning.trim();
  const patternText = rawPattern.slice(0, 200);

  const [upserted] = await db
    .insert(rejectionPatterns)
    .values({
      patternText,
      sourceCritiqueId: critiqueId,
      frequencyCount: 1,
    })
    .onConflictDoUpdate({
      target: rejectionPatterns.patternText,
      set: {
        frequencyCount: sql`${rejectionPatterns.frequencyCount} + 1`,
        lastSeen: new Date().toISOString(),
        sourceCritiqueId: critiqueId,
      },
    })
    .returning({ id: rejectionPatterns.id, frequencyCount: rejectionPatterns.frequencyCount });

  const isNew = upserted.frequencyCount === 1;

  console.error(`[rejection-patterns] Upserted pattern: "${patternText.slice(0, 60)}..." (freq: ${upserted.frequencyCount})`);

  return { patternId: upserted.id, isNew };
}

/**
 * Returns the top N most frequent rejection patterns. Used by generation service
 * to inject anti-patterns into generation instructions.
 */
export async function getTopPatterns(limit: number = 10): Promise<Array<{
  id: string;
  patternText: string;
  frequencyCount: number;
  lastSeen: string;
}>> {
  return db
    .select({
      id: rejectionPatterns.id,
      patternText: rejectionPatterns.patternText,
      frequencyCount: rejectionPatterns.frequencyCount,
      lastSeen: rejectionPatterns.lastSeen,
    })
    .from(rejectionPatterns)
    .orderBy(desc(rejectionPatterns.frequencyCount))
    .limit(limit);
}

/**
 * Returns all rejection patterns ordered by frequency descending.
 * Used by the MCP rejection-patterns resource.
 */
export async function getAllPatterns(): Promise<Array<{
  id: string;
  patternText: string;
  frequencyCount: number;
  lastSeen: string;
  createdAt: string;
}>> {
  return db
    .select({
      id: rejectionPatterns.id,
      patternText: rejectionPatterns.patternText,
      frequencyCount: rejectionPatterns.frequencyCount,
      lastSeen: rejectionPatterns.lastSeen,
      createdAt: rejectionPatterns.createdAt,
    })
    .from(rejectionPatterns)
    .orderBy(desc(rejectionPatterns.frequencyCount));
}

/**
 * Deletes a rejection pattern by ID. Returns { deleted: false, error } if not found.
 * Follows the same pattern as deleteRejectedIdea in retrieval.ts.
 */
export async function deletePattern(
  patternId: string,
): Promise<{ deleted: boolean; error?: string }> {
  const rows = await db
    .select({ id: rejectionPatterns.id })
    .from(rejectionPatterns)
    .where(eq(rejectionPatterns.id, patternId));

  if (rows.length === 0) {
    return { deleted: false, error: "Pattern not found" };
  }

  await db.delete(rejectionPatterns).where(eq(rejectionPatterns.id, patternId));

  return { deleted: true };
}

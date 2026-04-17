import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { beliefs, contradictions } from "../../db/schema.js";
import type { Belief, Contradiction } from "../../db/schema.js";

function parseTags(raw: string | null | undefined): string[] {
  try {
    return JSON.parse(raw ?? "[]");
  } catch (e) {
    console.error("Failed to parse contradiction-detector tags JSON:", e);
    return [];
  }
}

function serializeTags(tags: string[] | undefined): string {
  return JSON.stringify(tags ?? []);
}

export interface BeliefWithTags extends Omit<Belief, "tags"> {
  tags: string[];
}

function hydrateBelief(row: Belief): BeliefWithTags {
  return { ...row, tags: parseTags(row.tags) };
}

export interface ContradictionWithBeliefs {
  contradiction: Contradiction;
  belief_a: BeliefWithTags;
  belief_b: BeliefWithTags;
}

export function addBelief(
  statement: string,
  domain?: string,
  confidence?: number,
  source?: string,
  tags?: string[],
): BeliefWithTags {
  const rows = db
    .insert(beliefs)
    .values({
      statement,
      domain: domain ?? null,
      confidence: confidence ?? 0.5,
      source: source ?? null,
      tags: serializeTags(tags),
    })
    .returning()
    .all();
  return hydrateBelief(rows[0]);
}

export function getBelief(id: string): BeliefWithTags | null {
  const rows = db.select().from(beliefs).where(eq(beliefs.id, id)).all();
  if (rows.length === 0) return null;
  return hydrateBelief(rows[0]);
}

export function updateBelief(
  id: string,
  updates: Partial<{
    statement: string;
    domain: string;
    confidence: number;
    source: string;
    tags: string[];
  }>,
): BeliefWithTags {
  const existing = db.select().from(beliefs).where(eq(beliefs.id, id)).all();
  if (existing.length === 0) {
    throw new Error(`Belief not found: ${id}`);
  }

  const setValues: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };

  if (updates.statement !== undefined) setValues.statement = updates.statement;
  if (updates.domain !== undefined) setValues.domain = updates.domain;
  if (updates.confidence !== undefined) setValues.confidence = updates.confidence;
  if (updates.source !== undefined) setValues.source = updates.source;
  if (updates.tags !== undefined) setValues.tags = serializeTags(updates.tags);

  db.update(beliefs).set(setValues).where(eq(beliefs.id, id)).run();

  const updated = db.select().from(beliefs).where(eq(beliefs.id, id)).all();
  return hydrateBelief(updated[0]);
}

export function listBeliefs(domain?: string, tags?: string[]): BeliefWithTags[] {
  let rows = db.select().from(beliefs).all();

  if (domain) {
    rows = rows.filter((r) => r.domain === domain);
  }

  if (tags && tags.length > 0) {
    rows = rows.filter((r) => {
      const rowTags = parseTags(r.tags);
      return tags.some((t) => rowTags.includes(t));
    });
  }

  return rows.map(hydrateBelief);
}

export function reportContradiction(
  beliefAId: string,
  beliefBId: string,
  explanation: string,
): ContradictionWithBeliefs {
  const beliefA = db.select().from(beliefs).where(eq(beliefs.id, beliefAId)).all();
  if (beliefA.length === 0) {
    throw new Error(`Belief not found: ${beliefAId}`);
  }

  const beliefB = db.select().from(beliefs).where(eq(beliefs.id, beliefBId)).all();
  if (beliefB.length === 0) {
    throw new Error(`Belief not found: ${beliefBId}`);
  }

  const rows = db
    .insert(contradictions)
    .values({
      beliefAId,
      beliefBId,
      explanation,
      status: "unresolved",
    })
    .returning()
    .all();

  return {
    contradiction: rows[0],
    belief_a: hydrateBelief(beliefA[0]),
    belief_b: hydrateBelief(beliefB[0]),
  };
}

export function resolveContradiction(
  contradictionId: string,
  resolution: string,
): Contradiction {
  const rows = db
    .select()
    .from(contradictions)
    .where(eq(contradictions.id, contradictionId))
    .all();
  if (rows.length === 0) {
    throw new Error(`Contradiction not found: ${contradictionId}`);
  }

  const now = new Date().toISOString();
  db.update(contradictions)
    .set({
      status: "resolved",
      resolution,
      resolvedAt: now,
    })
    .where(eq(contradictions.id, contradictionId))
    .run();

  const updated = db
    .select()
    .from(contradictions)
    .where(eq(contradictions.id, contradictionId))
    .all();
  if (updated.length === 0) {
    throw new Error(`Contradiction not found after update: ${contradictionId}`);
  }
  return updated[0];
}

export function acceptContradiction(contradictionId: string): Contradiction {
  const rows = db
    .select()
    .from(contradictions)
    .where(eq(contradictions.id, contradictionId))
    .all();
  if (rows.length === 0) {
    throw new Error(`Contradiction not found: ${contradictionId}`);
  }

  const now = new Date().toISOString();
  db.update(contradictions)
    .set({
      status: "accepted",
      resolvedAt: now,
    })
    .where(eq(contradictions.id, contradictionId))
    .run();

  const updated = db
    .select()
    .from(contradictions)
    .where(eq(contradictions.id, contradictionId))
    .all();
  if (updated.length === 0) {
    throw new Error(`Contradiction not found after update: ${contradictionId}`);
  }
  return updated[0];
}

export function listContradictions(status?: string): ContradictionWithBeliefs[] {
  let rows = db.select().from(contradictions).all();

  if (status && status !== "all") {
    rows = rows.filter((r) => r.status === status);
  }

  const allBeliefs = db.select().from(beliefs).all();
  const beliefMap = new Map(allBeliefs.map((b) => [b.id, b]));

  return rows
    .map((c) => {
      const beliefA = beliefMap.get(c.beliefAId);
      const beliefB = beliefMap.get(c.beliefBId);
      if (!beliefA || !beliefB) return null;
      return {
        contradiction: c,
        belief_a: hydrateBelief(beliefA),
        belief_b: hydrateBelief(beliefB),
      };
    })
    .filter((x): x is ContradictionWithBeliefs => x !== null);
}

export function findPotentialContradictions(beliefId: string): BeliefWithTags[] {
  const target = db.select().from(beliefs).where(eq(beliefs.id, beliefId)).all();
  if (target.length === 0) {
    throw new Error(`Belief not found: ${beliefId}`);
  }

  const targetBelief = target[0];
  let candidates = db.select().from(beliefs).all();

  // Exclude the belief itself
  candidates = candidates.filter((b) => b.id !== beliefId);

  // If the target has a domain, return only same-domain beliefs
  if (targetBelief.domain) {
    const sameDomain = candidates.filter((b) => b.domain === targetBelief.domain);
    if (sameDomain.length > 0) {
      return sameDomain.map(hydrateBelief);
    }
  }

  // Fallback: return all other beliefs if no domain or no same-domain matches
  return candidates.map(hydrateBelief);
}

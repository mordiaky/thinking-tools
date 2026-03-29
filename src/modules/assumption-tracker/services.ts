import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { assumptions } from "../../db/schema.js";
import type { Assumption } from "../../db/schema.js";

const IMPACT_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function parseTags(raw: string | null | undefined): string[] {
  try {
    return JSON.parse(raw ?? "[]");
  } catch {
    return [];
  }
}

function serializeTags(tags: string[] | undefined): string {
  return JSON.stringify(tags ?? []);
}

export interface AssumptionWithTags extends Omit<Assumption, "tags"> {
  tags: string[];
}

function hydrate(row: Assumption): AssumptionWithTags {
  return { ...row, tags: parseTags(row.tags) };
}

export function createAssumption(
  statement: string,
  context?: string,
  impact?: string,
  confidence?: number,
  source?: string,
  tags?: string[],
): AssumptionWithTags {
  const rows = db
    .insert(assumptions)
    .values({
      statement,
      context: context ?? null,
      impact: impact ?? "medium",
      confidence: confidence ?? 0.5,
      source: source ?? null,
      status: "untested",
      tags: serializeTags(tags),
    })
    .returning()
    .all();
  return hydrate(rows[0]);
}

export function getAssumption(id: string): AssumptionWithTags | null {
  const rows = db.select().from(assumptions).where(eq(assumptions.id, id)).all();
  if (rows.length === 0) return null;
  return hydrate(rows[0]);
}

export function updateAssumption(
  id: string,
  updates: Partial<{
    statement: string;
    context: string;
    confidence: number;
    impact: string;
    source: string;
    tags: string[];
  }>,
): AssumptionWithTags {
  const existing = db.select().from(assumptions).where(eq(assumptions.id, id)).all();
  if (existing.length === 0) {
    throw new Error(`Assumption not found: ${id}`);
  }

  const setValues: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };

  if (updates.statement !== undefined) setValues.statement = updates.statement;
  if (updates.context !== undefined) setValues.context = updates.context;
  if (updates.confidence !== undefined) setValues.confidence = updates.confidence;
  if (updates.impact !== undefined) setValues.impact = updates.impact;
  if (updates.source !== undefined) setValues.source = updates.source;
  if (updates.tags !== undefined) setValues.tags = serializeTags(updates.tags);

  db.update(assumptions).set(setValues).where(eq(assumptions.id, id)).run();

  const updated = db.select().from(assumptions).where(eq(assumptions.id, id)).all();
  return hydrate(updated[0]);
}

export function testAssumption(
  id: string,
  evidence: string,
  result: "validated" | "invalidated",
): AssumptionWithTags {
  const rows = db.select().from(assumptions).where(eq(assumptions.id, id)).all();
  if (rows.length === 0) {
    throw new Error(`Assumption not found: ${id}`);
  }

  const current = rows[0];
  const now = new Date().toISOString();

  let newConfidence: number;
  if (result === "validated") {
    newConfidence = Math.max(current.confidence ?? 0.5, 0.8);
  } else {
    newConfidence = Math.min(current.confidence ?? 0.5, 0.2);
  }

  db.update(assumptions)
    .set({
      status: result,
      evidenceText: evidence,
      confidence: newConfidence,
      testedAt: now,
      updatedAt: now,
    })
    .where(eq(assumptions.id, id))
    .run();

  const updated = db.select().from(assumptions).where(eq(assumptions.id, id)).all();
  return hydrate(updated[0]);
}

export function listAssumptions(
  status?: string,
  impact?: string,
  tags?: string[],
): AssumptionWithTags[] {
  let rows = db.select().from(assumptions).all();

  if (status && status !== "all") {
    rows = rows.filter((r) => r.status === status);
  }

  if (impact) {
    rows = rows.filter((r) => r.impact === impact);
  }

  if (tags && tags.length > 0) {
    rows = rows.filter((r) => {
      const rowTags = parseTags(r.tags);
      return tags.some((t) => rowTags.includes(t));
    });
  }

  rows.sort((a, b) => {
    const impactDiff = (IMPACT_ORDER[a.impact ?? "medium"] ?? 2) - (IMPACT_ORDER[b.impact ?? "medium"] ?? 2);
    if (impactDiff !== 0) return impactDiff;
    return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
  });

  return rows.map(hydrate);
}

export function getUntested(): AssumptionWithTags[] {
  const rows = db
    .select()
    .from(assumptions)
    .where(eq(assumptions.status, "untested"))
    .all();

  rows.sort(
    (a, b) =>
      (IMPACT_ORDER[a.impact ?? "medium"] ?? 2) - (IMPACT_ORDER[b.impact ?? "medium"] ?? 2),
  );

  return rows.map(hydrate);
}

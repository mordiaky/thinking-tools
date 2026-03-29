import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { learningEntries } from "../../db/schema.js";
import type { LearningEntry } from "../../db/schema.js";

export type EntryType = "mistake" | "insight" | "surprise" | "pattern" | "correction";
export type Severity = "low" | "medium" | "high";

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

export interface LearningEntryWithTags extends Omit<LearningEntry, "tags"> {
  tags: string[];
}

function hydrate(row: LearningEntry): LearningEntryWithTags {
  return { ...row, tags: parseTags(row.tags) };
}

export function createEntry(
  entryType: EntryType,
  title: string,
  content: string,
  lesson?: string,
  context?: string,
  severity?: Severity,
  tags?: string[],
): LearningEntryWithTags {
  const rows = db
    .insert(learningEntries)
    .values({
      entryType,
      title,
      content,
      lesson: lesson ?? null,
      context: context ?? null,
      severity: severity ?? "medium",
      tags: serializeTags(tags),
    })
    .returning()
    .all();
  return hydrate(rows[0]);
}

export function getEntry(id: string): LearningEntryWithTags | null {
  const rows = db.select().from(learningEntries).where(eq(learningEntries.id, id)).all();
  if (rows.length === 0) return null;
  return hydrate(rows[0]);
}

export function updateEntry(
  id: string,
  updates: Partial<{
    title: string;
    content: string;
    lesson: string;
    context: string;
    severity: Severity;
    tags: string[];
  }>,
): LearningEntryWithTags {
  const existing = db.select().from(learningEntries).where(eq(learningEntries.id, id)).all();
  if (existing.length === 0) {
    throw new Error(`Learning entry not found: ${id}`);
  }

  const setValues: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };

  if (updates.title !== undefined) setValues.title = updates.title;
  if (updates.content !== undefined) setValues.content = updates.content;
  if (updates.lesson !== undefined) setValues.lesson = updates.lesson;
  if (updates.context !== undefined) setValues.context = updates.context;
  if (updates.severity !== undefined) setValues.severity = updates.severity;
  if (updates.tags !== undefined) setValues.tags = serializeTags(updates.tags);

  db.update(learningEntries).set(setValues).where(eq(learningEntries.id, id)).run();

  const updated = db.select().from(learningEntries).where(eq(learningEntries.id, id)).all();
  return hydrate(updated[0]);
}

export function listEntries(
  entryType?: EntryType,
  severity?: Severity,
  tags?: string[],
  limit?: number,
  offset?: number,
): { entries: LearningEntryWithTags[]; total: number } {
  let rows = db.select().from(learningEntries).all();

  if (entryType) {
    rows = rows.filter((r) => r.entryType === entryType);
  }

  if (severity) {
    rows = rows.filter((r) => r.severity === severity);
  }

  if (tags && tags.length > 0) {
    rows = rows.filter((r) => {
      const rowTags = parseTags(r.tags);
      return tags.some((t) => rowTags.includes(t));
    });
  }

  // Sort by created_at desc
  rows.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  const total = rows.length;
  const off = offset ?? 0;
  const lim = limit ?? 20;
  const paged = rows.slice(off, off + lim);

  return { entries: paged.map(hydrate), total };
}

export function searchEntries(query: string): LearningEntryWithTags[] {
  // Return all entries — caller does semantic matching
  const rows = db.select().from(learningEntries).all();
  // Sort by created_at desc
  rows.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return rows.map(hydrate);
}

export function getStats(): {
  total: number;
  byType: Record<EntryType, number>;
  bySeverity: Record<Severity, number>;
} {
  const rows = db.select().from(learningEntries).all();

  const byType: Record<EntryType, number> = {
    mistake: 0,
    insight: 0,
    surprise: 0,
    pattern: 0,
    correction: 0,
  };

  const bySeverity: Record<Severity, number> = {
    low: 0,
    medium: 0,
    high: 0,
  };

  for (const row of rows) {
    const t = row.entryType as EntryType;
    if (t in byType) byType[t]++;

    const s = (row.severity ?? "medium") as Severity;
    if (s in bySeverity) bySeverity[s]++;
  }

  return { total: rows.length, byType, bySeverity };
}

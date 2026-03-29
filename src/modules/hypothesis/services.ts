import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, sqlite } from "../../db/client.js";
import {
  hypotheses,
  evidence,
  confidenceHistory,
} from "../../db/schema.js";
import type {
  HypothesisRecord,
  EvidenceRecord,
  HypothesisWithCounts,
} from "./types.js";

function generateId(): string {
  return `hyp_${randomUUID()}`;
}

function generateEvidenceId(): string {
  return `ev_${randomUUID()}`;
}

function generateHistoryId(): string {
  return `ch_${randomUUID()}`;
}

function now(): string {
  return new Date().toISOString();
}

function rowToHypothesis(row: typeof hypotheses.$inferSelect): HypothesisRecord {
  let tags: string[];
  try {
    tags = JSON.parse(row.tags ?? "[]");
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    confidence: row.confidence ?? 0.5,
    status: (row.status ?? "active") as "active" | "confirmed" | "rejected",
    tags,
    context: row.context ?? null,
    created_at: row.createdAt ?? "",
    updated_at: row.updatedAt ?? "",
    resolved_at: row.resolvedAt ?? null,
    resolution: (row.resolution as "confirmed" | "rejected" | null) ?? null,
    final_evidence: row.finalEvidence ?? null,
  };
}

export function createHypothesis(
  title: string,
  description: string,
  initialConfidence: number,
  tags?: string[],
  context?: string,
): HypothesisRecord {
  const id = generateId();
  const timestamp = now();

  db.insert(hypotheses).values({
    id,
    title,
    description,
    confidence: initialConfidence,
    status: "active",
    tags: JSON.stringify(tags ?? []),
    context: context ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }).run();

  db.insert(confidenceHistory).values({
    id: generateHistoryId(),
    hypothesisId: id,
    confidence: initialConfidence,
    reason: "Initial confidence set at creation",
    createdAt: timestamp,
  }).run();

  return getHypothesis(id)!;
}

export function getHypothesis(id: string): HypothesisRecord | null {
  const rows = db.select().from(hypotheses).where(eq(hypotheses.id, id)).all();
  if (rows.length === 0) return null;
  return rowToHypothesis(rows[0]);
}

export function addEvidence(
  hypothesisId: string,
  type: "supporting" | "contradicting" | "neutral",
  description: string,
  weight: number,
  source: string | null,
  confidenceBefore: number,
  confidenceAfter: number,
): EvidenceRecord {
  const id = generateEvidenceId();
  const timestamp = now();

  db.insert(evidence).values({
    id,
    hypothesisId,
    type,
    description,
    weight,
    source: source ?? null,
    confidenceBefore,
    confidenceAfter,
    createdAt: timestamp,
  }).run();

  db.update(hypotheses)
    .set({ confidence: confidenceAfter, updatedAt: timestamp })
    .where(eq(hypotheses.id, hypothesisId))
    .run();

  db.insert(confidenceHistory).values({
    id: generateHistoryId(),
    hypothesisId,
    confidence: confidenceAfter,
    reason: `Evidence added: ${type} (weight: ${weight})`,
    createdAt: timestamp,
  }).run();

  return {
    id,
    hypothesis_id: hypothesisId,
    type,
    description,
    weight,
    source: source ?? null,
    confidence_before: confidenceBefore,
    confidence_after: confidenceAfter,
    created_at: timestamp,
  };
}

export function updateHypothesis(
  id: string,
  updates: {
    confidence?: number;
    description?: string;
    tags?: string[];
  },
): HypothesisRecord | null {
  const existing = getHypothesis(id);
  if (!existing) return null;

  const timestamp = now();
  const setValues: Partial<typeof hypotheses.$inferInsert> = { updatedAt: timestamp };

  if (updates.confidence !== undefined) setValues.confidence = updates.confidence;
  if (updates.description !== undefined) setValues.description = updates.description;
  if (updates.tags !== undefined) setValues.tags = JSON.stringify(updates.tags);

  db.update(hypotheses).set(setValues).where(eq(hypotheses.id, id)).run();

  if (updates.confidence !== undefined && updates.confidence !== existing.confidence) {
    db.insert(confidenceHistory).values({
      id: generateHistoryId(),
      hypothesisId: id,
      confidence: updates.confidence,
      reason: "Manual confidence update",
      createdAt: timestamp,
    }).run();
  }

  return getHypothesis(id);
}

export function listHypotheses(
  status: "active" | "confirmed" | "rejected" | "all",
  sortBy: "confidence" | "created" | "updated",
  tags?: string[],
): HypothesisWithCounts[] {
  const orderMap: Record<string, string> = {
    confidence: "h.confidence DESC",
    created: "h.created_at DESC",
    updated: "h.updated_at DESC",
  };

  const orderClause = orderMap[sortBy];
  if (!orderClause) {
    throw new Error(`Invalid sort field: ${sortBy}`);
  }

  const whereClause = status !== "all" ? `WHERE h.status = '${status}'` : "";

  const rows = sqlite.prepare(`
    SELECT h.*,
      COUNT(e.id) as evidence_count,
      SUM(CASE WHEN e.type = 'supporting' THEN 1 ELSE 0 END) as supporting_count,
      SUM(CASE WHEN e.type = 'contradicting' THEN 1 ELSE 0 END) as contradicting_count
    FROM hypotheses h
    LEFT JOIN evidence e ON e.hypothesis_id = h.id
    ${whereClause}
    GROUP BY h.id
    ORDER BY ${orderClause}
  `).all() as Array<Record<string, unknown>>;

  let results: HypothesisWithCounts[] = rows.map((row) => {
    let parsedTags: string[];
    try {
      parsedTags = JSON.parse(row.tags as string);
    } catch {
      parsedTags = [];
    }
    return {
      id: row.id as string,
      title: row.title as string,
      description: row.description as string,
      confidence: row.confidence as number,
      status: row.status as "active" | "confirmed" | "rejected",
      tags: parsedTags,
      context: (row.context as string | null) ?? null,
      created_at: (row.created_at as string) ?? "",
      updated_at: (row.updated_at as string) ?? "",
      resolved_at: (row.resolved_at as string | null) ?? null,
      resolution: (row.resolution as "confirmed" | "rejected" | null) ?? null,
      final_evidence: (row.final_evidence as string | null) ?? null,
      evidence_count: (row.evidence_count as number) ?? 0,
      supporting_count: (row.supporting_count as number) ?? 0,
      contradicting_count: (row.contradicting_count as number) ?? 0,
    };
  });

  if (tags && tags.length > 0) {
    results = results.filter((h) => tags.some((tag) => h.tags.includes(tag)));
  }

  return results;
}

export function resolveHypothesis(
  id: string,
  resolution: "confirmed" | "rejected",
  finalEvidence: string,
  confidence?: number,
): HypothesisRecord | null {
  const existing = getHypothesis(id);
  if (!existing) return null;

  const timestamp = now();
  const finalConfidence = confidence ?? (resolution === "confirmed" ? 0.99 : 0.01);

  db.update(hypotheses)
    .set({
      status: resolution,
      resolution,
      finalEvidence,
      confidence: finalConfidence,
      resolvedAt: timestamp,
      updatedAt: timestamp,
    })
    .where(eq(hypotheses.id, id))
    .run();

  db.insert(confidenceHistory).values({
    id: generateHistoryId(),
    hypothesisId: id,
    confidence: finalConfidence,
    reason: `Hypothesis resolved: ${resolution}`,
    createdAt: timestamp,
  }).run();

  return getHypothesis(id);
}

export function getHypothesisHistory(
  id: string,
): { hypothesis: HypothesisRecord | null; events: Array<Record<string, unknown>> } {
  const hyp = getHypothesis(id);
  if (!hyp) return { hypothesis: null, events: [] };

  const evidenceRows = sqlite.prepare(
    "SELECT *, 'evidence_added' as event_type FROM evidence WHERE hypothesis_id = ? ORDER BY created_at",
  ).all(id) as Array<Record<string, unknown>>;

  const historyRows = sqlite.prepare(
    "SELECT *, 'confidence_changed' as event_type FROM confidence_history WHERE hypothesis_id = ? ORDER BY created_at",
  ).all(id) as Array<Record<string, unknown>>;

  const events = [...evidenceRows, ...historyRows].sort((a, b) =>
    (a.created_at as string).localeCompare(b.created_at as string),
  );

  return { hypothesis: hyp, events };
}

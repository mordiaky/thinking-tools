import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { arguments_, argumentNodes } from "../../db/schema.js";
import type { Argument, ArgumentNode } from "../../db/schema.js";

function parseTags(raw: string | null | undefined): string[] {
  try {
    return JSON.parse(raw ?? "[]");
  } catch (e) {
    console.error("Failed to parse argument-mapper tags JSON:", e);
    return [];
  }
}

function serializeTags(tags: string[] | undefined): string {
  return JSON.stringify(tags ?? []);
}

export interface ArgumentWithTags extends Omit<Argument, "tags"> {
  tags: string[];
}

export interface TreeNode extends ArgumentNode {
  children: TreeNode[];
}

export interface ArgumentWithTree {
  argument: ArgumentWithTags;
  nodes: TreeNode[];
  node_count: number;
}

export interface ArgumentSummary extends ArgumentWithTags {
  node_count: number;
}

function hydrateArgument(row: Argument): ArgumentWithTags {
  return { ...row, tags: parseTags(row.tags) };
}

function buildTree(nodes: ArgumentNode[]): TreeNode[] {
  const nodeMap = new Map<string, TreeNode>();
  for (const n of nodes) {
    nodeMap.set(n.id, { ...n, children: [] });
  }

  const roots: TreeNode[] = [];
  for (const n of nodeMap.values()) {
    if (!n.parentNodeId) {
      roots.push(n);
    } else {
      const parent = nodeMap.get(n.parentNodeId);
      if (parent) {
        parent.children.push(n);
      } else {
        // Orphaned node — treat as root
        roots.push(n);
      }
    }
  }

  return roots;
}

export function createArgument(
  topic: string,
  conclusion?: string,
  tags?: string[],
): ArgumentWithTags {
  const rows = db
    .insert(arguments_)
    .values({
      topic,
      conclusion: conclusion ?? null,
      status: "building",
      tags: serializeTags(tags),
    })
    .returning()
    .all();
  return hydrateArgument(rows[0]);
}

export function getArgument(id: string): ArgumentWithTree | null {
  const argRows = db.select().from(arguments_).where(eq(arguments_.id, id)).all();
  if (argRows.length === 0) return null;

  const nodes = db.select().from(argumentNodes).where(eq(argumentNodes.argumentId, id)).all();
  const tree = buildTree(nodes);

  return {
    argument: hydrateArgument(argRows[0]),
    nodes: tree,
    node_count: nodes.length,
  };
}

export function addNode(
  argumentId: string,
  type: string,
  content: string,
  parentNodeId?: string,
  strength?: string,
  source?: string,
): ArgumentNode {
  const argRows = db.select().from(arguments_).where(eq(arguments_.id, argumentId)).all();
  if (argRows.length === 0) {
    throw new Error(`Argument not found: ${argumentId}`);
  }

  if (parentNodeId) {
    const parentRows = db
      .select()
      .from(argumentNodes)
      .where(eq(argumentNodes.id, parentNodeId))
      .all();
    if (parentRows.length === 0) {
      throw new Error(`Parent node not found: ${parentNodeId}`);
    }
    if (parentRows[0].argumentId !== argumentId) {
      throw new Error("Parent node does not belong to the same argument");
    }
  }

  const rows = db
    .insert(argumentNodes)
    .values({
      argumentId,
      type,
      content,
      parentNodeId: parentNodeId ?? null,
      strength: strength ?? "medium",
      source: source ?? null,
    })
    .returning()
    .all();
  return rows[0];
}

export function updateArgument(
  id: string,
  updates: Partial<{
    topic: string;
    conclusion: string;
    status: string;
    tags: string[];
  }>,
): ArgumentWithTags {
  const existing = db.select().from(arguments_).where(eq(arguments_.id, id)).all();
  if (existing.length === 0) {
    throw new Error(`Argument not found: ${id}`);
  }

  const setValues: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };

  if (updates.topic !== undefined) setValues.topic = updates.topic;
  if (updates.conclusion !== undefined) setValues.conclusion = updates.conclusion;
  if (updates.status !== undefined) setValues.status = updates.status;
  if (updates.tags !== undefined) setValues.tags = serializeTags(updates.tags);

  db.update(arguments_).set(setValues).where(eq(arguments_.id, id)).run();

  const updated = db.select().from(arguments_).where(eq(arguments_.id, id)).all();
  return hydrateArgument(updated[0]);
}

export function updateNode(
  nodeId: string,
  updates: Partial<{
    content: string;
    strength: string;
    source: string;
  }>,
): ArgumentNode {
  const existing = db.select().from(argumentNodes).where(eq(argumentNodes.id, nodeId)).all();
  if (existing.length === 0) {
    throw new Error(`Node not found: ${nodeId}`);
  }

  const setValues: Record<string, unknown> = {};

  if (updates.content !== undefined) setValues.content = updates.content;
  if (updates.strength !== undefined) setValues.strength = updates.strength;
  if (updates.source !== undefined) setValues.source = updates.source;

  db.update(argumentNodes).set(setValues).where(eq(argumentNodes.id, nodeId)).run();

  const updated = db.select().from(argumentNodes).where(eq(argumentNodes.id, nodeId)).all();
  if (updated.length === 0) {
    throw new Error(`Node not found after update: ${nodeId}`);
  }
  return updated[0];
}

export function listArguments(status?: string, tags?: string[]): ArgumentSummary[] {
  let rows = db.select().from(arguments_).all();

  if (status && status !== "all") {
    rows = rows.filter((r) => r.status === status);
  }

  if (tags && tags.length > 0) {
    rows = rows.filter((r) => {
      const rowTags = parseTags(r.tags);
      return tags.some((t) => rowTags.includes(t));
    });
  }

  const allNodes = db.select().from(argumentNodes).all();
  const countMap = new Map<string, number>();
  for (const n of allNodes) {
    countMap.set(n.argumentId, (countMap.get(n.argumentId) ?? 0) + 1);
  }

  return rows.map((r) => ({
    ...hydrateArgument(r),
    node_count: countMap.get(r.id) ?? 0,
  }));
}

export function completeArgument(id: string, conclusion: string): ArgumentWithTags {
  const existing = db.select().from(arguments_).where(eq(arguments_.id, id)).all();
  if (existing.length === 0) {
    throw new Error(`Argument not found: ${id}`);
  }

  const now = new Date().toISOString();
  db.update(arguments_)
    .set({
      status: "complete",
      conclusion,
      updatedAt: now,
    })
    .where(eq(arguments_.id, id))
    .run();

  const updated = db.select().from(arguments_).where(eq(arguments_.id, id)).all();
  return hydrateArgument(updated[0]);
}

export function challengeArgument(id: string): ArgumentWithTags {
  const existing = db.select().from(arguments_).where(eq(arguments_.id, id)).all();
  if (existing.length === 0) {
    throw new Error(`Argument not found: ${id}`);
  }

  const now = new Date().toISOString();
  db.update(arguments_)
    .set({
      status: "challenged",
      updatedAt: now,
    })
    .where(eq(arguments_.id, id))
    .run();

  const updated = db.select().from(arguments_).where(eq(arguments_.id, id)).all();
  return hydrateArgument(updated[0]);
}

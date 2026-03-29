import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { mentalModelApplications } from "../../db/schema.js";
import type { MentalModelApplication } from "../../db/schema.js";
import {
  MENTAL_MODEL_CATALOG,
  getModelByName,
  getAllModelNames,
  type MentalModel,
} from "./catalog.js";

export interface ApplicationWithModel {
  application: MentalModelApplication;
  model: MentalModel;
}

export function applyModel(
  modelName: string,
  problem: string,
  analysis: string,
  insights?: string,
  tags?: string[],
): ApplicationWithModel {
  const model = getModelByName(modelName);
  if (!model) {
    throw new Error(
      `Unknown mental model: "${modelName}". Available models: ${getAllModelNames().join(", ")}`,
    );
  }

  const rows = db
    .insert(mentalModelApplications)
    .values({
      modelName,
      problem,
      analysis,
      insights: insights ?? null,
      tags: JSON.stringify(tags ?? []),
    })
    .returning()
    .all();

  return { application: rows[0], model };
}

export function getApplication(id: string): ApplicationWithModel | null {
  const rows = db
    .select()
    .from(mentalModelApplications)
    .where(eq(mentalModelApplications.id, id))
    .all();

  if (rows.length === 0) return null;

  const model = getModelByName(rows[0].modelName);
  if (!model) return null;

  return { application: rows[0], model };
}

export function listApplications(
  modelName?: string,
  tags?: string[],
): MentalModelApplication[] {
  let rows: MentalModelApplication[];

  if (modelName) {
    rows = db
      .select()
      .from(mentalModelApplications)
      .where(eq(mentalModelApplications.modelName, modelName))
      .all();
  } else {
    rows = db.select().from(mentalModelApplications).all();
  }

  if (tags && tags.length > 0) {
    rows = rows.filter((r) => {
      let parsedTags: string[];
      try {
        parsedTags = JSON.parse(r.tags ?? "[]");
      } catch {
        parsedTags = [];
      }
      return tags.some((tag) => parsedTags.includes(tag));
    });
  }

  return rows;
}

export function getCatalog(): MentalModel[] {
  return MENTAL_MODEL_CATALOG;
}

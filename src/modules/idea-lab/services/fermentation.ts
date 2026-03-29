import { db } from "../../../db/client.js";
import { ideas, scores, fermentationAlerts } from "../../../db/schema.js";
import { eq, isNull, ne, desc } from "drizzle-orm";

export interface FermentationAlert {
  alertId: string;
  ideaId: string;
  ideaTitle: string;
  ideaStatus: string;
  alertType: string;
  previousComposite: number;
  newComposite: number;
  delta: number;
  triggeredAt: string;
  trajectory: "RISING" | "STABLE" | "DECLINING";
  daysSinceRescore: number;
}

export interface CheckFermentationResult {
  alerts: FermentationAlert[];
  topAlert: FermentationAlert | null;
  totalAcknowledged: number;
}

/**
 * Returns unacknowledged fermentation alerts for non-rejected ideas, sorted by
 * absolute delta descending (most significant first). Marks all returned alerts
 * as acknowledged. Pull-based — no background notifications.
 */
export async function checkFermentationAlerts(
  limit: number = 10,
): Promise<CheckFermentationResult> {
  const clampedLimit = Math.min(Math.max(1, limit), 20);

  // Fetch unacknowledged alerts joined with idea title/status
  const alertRows = await db
    .select({
      alertId: fermentationAlerts.id,
      ideaId: fermentationAlerts.ideaId,
      alertType: fermentationAlerts.alertType,
      previousComposite: fermentationAlerts.previousComposite,
      newComposite: fermentationAlerts.newComposite,
      delta: fermentationAlerts.delta,
      triggeredAt: fermentationAlerts.triggeredAt,
      ideaTitle: ideas.title,
      ideaStatus: ideas.status,
      ideaLastScoredAt: ideas.lastScoredAt,
    })
    .from(fermentationAlerts)
    .innerJoin(ideas, eq(ideas.id, fermentationAlerts.ideaId))
    .where(isNull(fermentationAlerts.acknowledgedAt))
    .orderBy(desc(fermentationAlerts.delta));

  // Filter out rejected ideas
  const filtered = alertRows.filter((r) => r.ideaStatus !== "rejected");

  // Sort by absolute delta magnitude descending
  const sorted = filtered.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const topN = sorted.slice(0, clampedLimit);

  // For each alert, compute trajectory from last two scores
  const enriched: FermentationAlert[] = await Promise.all(
    topN.map(async (row) => {
      // Compute trajectory
      let trajectory: "RISING" | "STABLE" | "DECLINING";
      if (row.delta > 0.5) {
        trajectory = "RISING";
      } else if (row.delta < -0.5) {
        trajectory = "DECLINING";
      } else {
        trajectory = "STABLE";
      }

      // Compute days since rescore
      let daysSinceRescore = 0;
      if (row.ideaLastScoredAt) {
        const lastScored = new Date(row.ideaLastScoredAt).getTime();
        const now = Date.now();
        daysSinceRescore = Math.floor((now - lastScored) / (1000 * 60 * 60 * 24));
      }

      return {
        alertId: row.alertId,
        ideaId: row.ideaId,
        ideaTitle: row.ideaTitle,
        ideaStatus: row.ideaStatus,
        alertType: row.alertType,
        previousComposite: row.previousComposite,
        newComposite: row.newComposite,
        delta: row.delta,
        triggeredAt: row.triggeredAt,
        trajectory,
        daysSinceRescore,
      };
    }),
  );

  // Mark all returned alerts as acknowledged
  const acknowledgedAt = new Date().toISOString();
  for (const alert of enriched) {
    await db
      .update(fermentationAlerts)
      .set({ acknowledgedAt })
      .where(eq(fermentationAlerts.id, alert.alertId));
  }

  return {
    alerts: enriched,
    topAlert: enriched.length > 0 ? enriched[0] : null,
    totalAcknowledged: enriched.length,
  };
}

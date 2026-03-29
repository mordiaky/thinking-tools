import { db } from "../../../db/client.js";
import { ideas, scores } from "../../../db/schema.js";
import { sql, ne, eq } from "drizzle-orm";

export interface DomainStats {
  domain: string;
  ideaCount: number;
  avgComposite: number | null;
  avgRisk: number | null;      // avg of (feasibility + defensibility) / 2
  avgSpeedToMvp: number | null;
}

export interface PortfolioOverview {
  totalIdeas: number;
  domainCount: number;
  domains: DomainStats[];
  gaps: string[];  // domains with < 2 ideas or no scored ideas
}

/**
 * Returns portfolio distribution grouped by domain. Excludes rejected ideas.
 * Computes average composite score, risk proxy (avg of feasibility + defensibility / 2),
 * and average speed-to-MVP per domain via a left join with scores table.
 */
export async function getPortfolioOverview(): Promise<PortfolioOverview> {
  const rows = await db
    .select({
      domain: ideas.domain,
      ideaCount: sql<number>`cast(count(${ideas.id}) as int)`,
      avgComposite: sql<number | null>`avg(${scores.composite})`,
      avgRisk: sql<number | null>`avg((${scores.feasibility} + ${scores.defensibility}) / 2.0)`,
      avgSpeedToMvp: sql<number | null>`avg(${scores.speedToMvp})`,
    })
    .from(ideas)
    .leftJoin(scores, eq(scores.ideaId, ideas.id))
    .where(ne(ideas.status, "rejected"))
    .groupBy(ideas.domain);

  const domains: DomainStats[] = rows.map((row) => ({
    domain: row.domain ?? "uncategorized",
    ideaCount: row.ideaCount,
    avgComposite: row.avgComposite !== null ? Number(row.avgComposite) : null,
    avgRisk: row.avgRisk !== null ? Number(row.avgRisk) : null,
    avgSpeedToMvp: row.avgSpeedToMvp !== null ? Number(row.avgSpeedToMvp) : null,
  }));

  const totalIdeas = domains.reduce((sum, d) => sum + d.ideaCount, 0);
  const gaps = domains
    .filter((d) => d.ideaCount < 2 || d.avgComposite === null)
    .map((d) => d.domain);

  return {
    totalIdeas,
    domainCount: domains.length,
    domains,
    gaps,
  };
}

/**
 * Returns domain names that have fewer ideas than the average count across all domains.
 * If allDomains is provided, also includes domains from that list that have zero ideas stored.
 * Used by the diversify flag in generateIdeas.
 */
export async function getUnderrepresentedDomains(allDomains?: string[]): Promise<string[]> {
  const overview = await getPortfolioOverview();

  if (overview.totalIdeas === 0) {
    // No ideas stored yet — return provided domains as all equally underrepresented
    return allDomains ?? [];
  }

  const avgCount = overview.totalIdeas / Math.max(overview.domainCount, 1);
  const underrepresented: string[] = overview.domains
    .filter((d) => d.ideaCount < avgCount)
    .map((d) => d.domain);

  // Include zero-count domains from allDomains that aren't represented at all
  if (allDomains && allDomains.length > 0) {
    const existingDomains = new Set(overview.domains.map((d) => d.domain));
    for (const domain of allDomains) {
      if (!existingDomains.has(domain) && !underrepresented.includes(domain)) {
        underrepresented.push(domain);
      }
    }
  }

  return underrepresented;
}

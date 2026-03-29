import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createEntry,
  listEntries,
  searchEntries,
  getStats,
} from "./services.js";
import type { EntryType, Severity } from "./services.js";

export function registerLearningJournalTools(server: McpServer): void {
  server.tool(
    "learning_log",
    "Log a learning entry — record a mistake, insight, surprise, pattern, or correction for future reference",
    {
      entry_type: z
        .enum(["mistake", "insight", "surprise", "pattern", "correction"])
        .describe("Type of learning: mistake (what went wrong), insight (new understanding), surprise (unexpected discovery), pattern (recurring observation), correction (fixing a wrong belief)"),
      title: z.string().max(500).describe("Short title for the entry"),
      content: z.string().max(10000).describe("Detailed description of what happened"),
      lesson: z.string().max(5000).optional().describe("Key takeaway or lesson learned"),
      context: z.string().max(5000).optional().describe("When and where this happened"),
      severity: z
        .enum(["low", "medium", "high"])
        .default("medium")
        .describe("Severity or importance (default: medium)"),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
    },
    async ({ entry_type, title, content, lesson, context, severity, tags }) => {
      const entry = createEntry(
        entry_type as EntryType,
        title,
        content,
        lesson,
        context,
        severity as Severity,
        tags,
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(entry, null, 2) }],
      };
    },
  );

  server.tool(
    "learning_list",
    "List learning journal entries with optional filters and pagination",
    {
      entry_type: z
        .enum(["mistake", "insight", "surprise", "pattern", "correction"])
        .optional()
        .describe("Filter by entry type"),
      severity: z
        .enum(["low", "medium", "high"])
        .optional()
        .describe("Filter by severity"),
      tags: z.array(z.string()).optional().describe("Filter by tags (any match)"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(20)
        .describe("Max entries to return (1-50, default 20)"),
      offset: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("Pagination offset (default 0)"),
    },
    async ({ entry_type, severity, tags, limit, offset }) => {
      const result = listEntries(
        entry_type as EntryType | undefined,
        severity as Severity | undefined,
        tags,
        limit,
        offset,
      );
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                total_matching: result.total,
                returned: result.entries.length,
                offset,
                limit,
                entries: result.entries,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "learning_search",
    "Search learning journal entries — returns all entries for semantic matching by caller. Useful for 'have I made this mistake before?' or 'what do I know about X?'",
    {
      query: z.string().max(1000).describe("Search query — caller evaluates semantic relevance"),
    },
    async ({ query }) => {
      const entries = searchEntries(query);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                query,
                count: entries.length,
                note: "All entries returned — evaluate semantic relevance to query",
                entries: entries.map((e) => ({
                  id: e.id,
                  entry_type: e.entryType,
                  title: e.title,
                  content: e.content,
                  lesson: e.lesson,
                  severity: e.severity,
                  tags: e.tags,
                  created_at: e.createdAt,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "learning_stats",
    "Get learning journal statistics — count breakdown by entry type and severity for meta-reflection",
    {},
    async () => {
      const stats = getStats();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(stats, null, 2),
          },
        ],
      };
    },
  );
}

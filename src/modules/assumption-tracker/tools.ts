import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createAssumption,
  getAssumption,
  updateAssumption,
  testAssumption,
  listAssumptions,
  getUntested,
} from "./services.js";

export function registerAssumptionTrackerTools(server: McpServer): void {
  server.tool(
    "assumption_create",
    "Record an assumption that needs to be tested — a belief you're acting on but haven't verified",
    {
      statement: z.string().max(2000).describe("The assumption statement"),
      context: z.string().max(5000).optional().describe("Context where this assumption applies"),
      impact: z
        .enum(["low", "medium", "high", "critical"])
        .default("medium")
        .describe("Impact if assumption is wrong (default: medium)"),
      confidence: z
        .number()
        .min(0)
        .max(1)
        .default(0.5)
        .describe("Initial confidence level 0-1 (default: 0.5)"),
      source: z.string().max(500).optional().describe("Where this assumption comes from"),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
    },
    async ({ statement, context, impact, confidence, source, tags }) => {
      const assumption = createAssumption(statement, context, impact, confidence, source, tags);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(assumption, null, 2) }],
      };
    },
  );

  server.tool(
    "assumption_test",
    "Record the result of testing an assumption — mark it validated or invalidated with evidence",
    {
      assumption_id: z.string().describe("ID of the assumption to test"),
      evidence: z.string().max(5000).describe("Description of the test and what was found"),
      result: z.enum(["validated", "invalidated"]).describe("Test result"),
    },
    async ({ assumption_id, evidence, result }) => {
      try {
        const assumption = testAssumption(assumption_id, evidence, result);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(assumption, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: String(err) }, null, 2) }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "assumption_update",
    "Update an assumption's statement, context, confidence, impact, source, or tags",
    {
      assumption_id: z.string().describe("ID of the assumption"),
      statement: z.string().max(2000).optional().describe("Updated statement"),
      context: z.string().max(5000).optional().describe("Updated context"),
      confidence: z.number().min(0).max(1).optional().describe("Updated confidence 0-1"),
      impact: z.enum(["low", "medium", "high", "critical"]).optional().describe("Updated impact"),
      source: z.string().max(500).optional().describe("Updated source"),
      tags: z.array(z.string()).optional().describe("Updated tags"),
    },
    async ({ assumption_id, statement, context, confidence, impact, source, tags }) => {
      try {
        const assumption = updateAssumption(assumption_id, {
          statement,
          context,
          confidence,
          impact,
          source,
          tags,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(assumption, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: String(err) }, null, 2) }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "assumption_list",
    "List assumptions with optional filters — useful for reviewing what you believe vs what you've verified",
    {
      status: z
        .enum(["untested", "testing", "validated", "invalidated", "all"])
        .default("all")
        .describe("Filter by status (default: all)"),
      impact: z
        .enum(["low", "medium", "high", "critical"])
        .optional()
        .describe("Filter by impact level"),
      tags: z.array(z.string()).optional().describe("Filter by tags (any match)"),
    },
    async ({ status, impact, tags }) => {
      const assumptionList = listAssumptions(status, impact, tags);

      const counts = assumptionList.reduce<Record<string, number>>(
        (acc, a) => {
          acc[a.status] = (acc[a.status] ?? 0) + 1;
          return acc;
        },
        {},
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                total: assumptionList.length,
                counts_by_status: counts,
                assumptions: assumptionList,
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
    "assumption_get_untested",
    "Get all untested assumptions sorted by impact — answers 'What should I test next?'",
    {},
    async () => {
      const untested = getUntested();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                count: untested.length,
                prompt: "What assumptions am I making that I haven't tested?",
                untested_assumptions: untested,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}

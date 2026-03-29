import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createDecision,
  addCriterion,
  addOption,
  rateOption,
  evaluateDecision,
  getDecision,
  listDecisions,
  decideOption,
} from "./services.js";

export function registerDecisionMatrixTools(server: McpServer): void {
  server.tool(
    "decision_create",
    "Create a new decision to evaluate with multi-criteria analysis",
    {
      title: z.string().max(500).describe("Title of the decision"),
      description: z.string().max(10000).optional().describe("Optional description"),
    },
    async ({ title, description }) => {
      const decision = createDecision(title, description);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(decision, null, 2) }],
      };
    },
  );

  server.tool(
    "decision_add_criterion",
    "Add a weighted criterion to a decision",
    {
      decision_id: z.string().describe("ID of the decision"),
      name: z.string().max(500).describe("Name of the criterion"),
      weight: z
        .number()
        .min(0.1)
        .max(10)
        .default(1)
        .describe("Importance weight (0.1-10, default 1)"),
      description: z.string().max(2000).optional().describe("Optional description"),
    },
    async ({ decision_id, name, weight, description }) => {
      try {
        const criterion = addCriterion(decision_id, name, weight, description);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(criterion, null, 2) }],
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
    "decision_add_option",
    "Add an option/alternative to evaluate in a decision",
    {
      decision_id: z.string().describe("ID of the decision"),
      name: z.string().max(500).describe("Name of the option"),
      description: z.string().max(2000).optional().describe("Optional description"),
    },
    async ({ decision_id, name, description }) => {
      try {
        const option = addOption(decision_id, name, description);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(option, null, 2) }],
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
    "decision_rate",
    "Rate an option against a criterion (score 0-10)",
    {
      option_id: z.string().describe("ID of the option"),
      criterion_id: z.string().describe("ID of the criterion"),
      score: z.number().min(0).max(10).describe("Score 0-10"),
      reasoning: z.string().max(2000).optional().describe("Optional reasoning for this rating"),
    },
    async ({ option_id, criterion_id, score, reasoning }) => {
      try {
        const rating = rateOption(option_id, criterion_id, score, reasoning);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(rating, null, 2) }],
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
    "decision_evaluate",
    "Evaluate a decision — compute weighted scores for all options and rank them",
    {
      decision_id: z.string().describe("ID of the decision"),
    },
    async ({ decision_id }) => {
      try {
        const ranked = evaluateDecision(decision_id);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  decision_id,
                  ranked_options: ranked,
                  winner: ranked[0] ?? null,
                },
                null,
                2,
              ),
            },
          ],
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
    "decision_choose",
    "Mark the chosen option and close the decision",
    {
      decision_id: z.string().describe("ID of the decision"),
      option_id: z.string().describe("ID of the chosen option"),
    },
    async ({ decision_id, option_id }) => {
      try {
        const decision = decideOption(decision_id, option_id);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(decision, null, 2) }],
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
    "decision_list",
    "List decisions with optional status filter",
    {
      status: z
        .enum(["open", "decided", "revisited", "all"])
        .default("all")
        .describe("Filter by status (default: all)"),
    },
    async ({ status }) => {
      const decisionList = listDecisions(status);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                count: decisionList.length,
                decisions: decisionList,
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
    "decision_get",
    "Get full details of a decision including criteria, options, ratings, and weighted scores",
    {
      decision_id: z.string().describe("ID of the decision"),
    },
    async ({ decision_id }) => {
      const detail = getDecision(decision_id);
      if (!detail) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `Decision not found: ${decision_id}` }, null, 2) }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(detail, null, 2) }],
      };
    },
  );
}

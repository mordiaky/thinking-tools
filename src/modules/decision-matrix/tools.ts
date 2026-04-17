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
import { toolOk, toolErr, wrapHandler } from "../../utils/tool-response.js";

export function registerDecisionMatrixTools(server: McpServer): void {
  server.tool(
    "decision_create",
    "Create a new decision to evaluate with multi-criteria analysis",
    {
      title: z.string().max(500).describe("Title of the decision"),
      description: z.string().max(10000).optional().describe("Optional description"),
    },
    wrapHandler(async ({ title, description }) => {
      const decision = createDecision(title, description);
      return toolOk(decision);
    }),
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
    wrapHandler(async ({ decision_id, name, weight, description }) => {
      const criterion = addCriterion(decision_id, name, weight, description);
      return toolOk(criterion);
    }),
  );

  server.tool(
    "decision_add_option",
    "Add an option/alternative to evaluate in a decision",
    {
      decision_id: z.string().describe("ID of the decision"),
      name: z.string().max(500).describe("Name of the option"),
      description: z.string().max(2000).optional().describe("Optional description"),
    },
    wrapHandler(async ({ decision_id, name, description }) => {
      const option = addOption(decision_id, name, description);
      return toolOk(option);
    }),
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
    wrapHandler(async ({ option_id, criterion_id, score, reasoning }) => {
      const rating = rateOption(option_id, criterion_id, score, reasoning);
      return toolOk(rating);
    }),
  );

  server.tool(
    "decision_evaluate",
    "Evaluate a decision — compute weighted scores for all options and rank them",
    {
      decision_id: z.string().describe("ID of the decision"),
    },
    wrapHandler(async ({ decision_id }) => {
      const ranked = evaluateDecision(decision_id);
      return toolOk({
        decision_id,
        ranked_options: ranked,
        winner: ranked[0] ?? null,
      });
    }),
  );

  server.tool(
    "decision_choose",
    "Mark the chosen option and close the decision",
    {
      decision_id: z.string().describe("ID of the decision"),
      option_id: z.string().describe("ID of the chosen option"),
    },
    wrapHandler(async ({ decision_id, option_id }) => {
      const decision = decideOption(decision_id, option_id);
      return toolOk(decision);
    }),
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
    wrapHandler(async ({ status }) => {
      const decisionList = listDecisions(status);
      return toolOk({
        count: decisionList.length,
        decisions: decisionList,
      });
    }),
  );

  server.tool(
    "decision_get",
    "Get full details of a decision including criteria, options, ratings, and weighted scores",
    {
      decision_id: z.string().describe("ID of the decision"),
    },
    wrapHandler(async ({ decision_id }) => {
      const detail = getDecision(decision_id);
      if (!detail) {
        return toolErr("NOT_FOUND", "Decision not found: " + decision_id);
      }
      return toolOk(detail);
    }),
  );
}

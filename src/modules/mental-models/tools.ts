import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  applyModel,
  listApplications,
  getCatalog,
} from "./services.js";
import { getAllModelNames } from "./catalog.js";
import { toolOk, wrapHandler } from "../../utils/tool-response.js";

export function registerMentalModelTools(server: McpServer): void {
  server.tool(
    "mental_model_apply",
    "Apply a named mental model framework to a problem and save the analysis",
    {
      model_name: z
        .string()
        .describe(
          `Name of the mental model to apply. Available: ${getAllModelNames().join(", ")}`,
        ),
      problem: z
        .string()
        .max(10000)
        .describe("The problem or situation to analyze"),
      analysis: z
        .string()
        .max(50000)
        .describe("Your analysis applying the model's steps to the problem"),
      insights: z
        .string()
        .max(10000)
        .optional()
        .describe("Key insights or conclusions from the analysis"),
      tags: z
        .array(z.string().max(100))
        .max(50)
        .optional()
        .describe("Optional tags for categorization"),
    },
    wrapHandler(async ({ model_name, problem, analysis, insights, tags }) => {
      const result = applyModel(model_name, problem, analysis, insights, tags);
      return toolOk({
        application: result.application,
        model_steps: result.model.steps,
        model_description: result.model.description,
      });
    }),
  );

  server.tool(
    "mental_model_list_models",
    "List all available mental models with descriptions and step-by-step guides",
    {},
    async () => {
      const catalog = getCatalog();
      return toolOk({
        count: catalog.length,
        models: catalog,
      });
    },
  );

  server.tool(
    "mental_model_history",
    "Retrieve past mental model applications, optionally filtered by model or tags",
    {
      model_name: z
        .string()
        .optional()
        .describe("Filter to a specific model name"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Filter by tags (matches any)"),
    },
    async ({ model_name, tags }) => {
      const applications = listApplications(model_name, tags);
      return toolOk({
        count: applications.length,
        applications,
      });
    },
  );
}

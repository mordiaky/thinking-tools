import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolOk, wrapHandler } from "../../utils/tool-response.js";
import { suggestNextAction } from "./services.js";

/**
 * Meta-tools that operate across modules. These live outside any single
 * thinking-tool module because their value is specifically in connecting
 * state from several of them.
 */
export function registerIntegrationTools(server: McpServer): void {
  server.tool(
    "suggest_next_action",
    "Scan state across every thinking-tools module and surface the single most valuable next action. Use this when you are unsure what to work on next, or when resuming a session. Returns a ranked list of concrete suggestions (untested critical assumptions, unresolved contradictions, stale hypotheses, shortlists ready for a decision, pipeline gaps in the idea lab). Pick one; do not try to address all of them.",
    {
      max_suggestions: z
        .number()
        .int()
        .min(1)
        .max(20)
        .default(5)
        .describe("Maximum suggestions to return (1-20, default 5)"),
    },
    wrapHandler(async ({ max_suggestions }) => {
      const result = suggestNextAction(max_suggestions);
      return toolOk({
        ...result,
        guidance:
          result.suggestions.length === 0
            ? "No outstanding cross-module gaps detected. Consider generating new ideas (idea_lab_generate_ideas), forming a hypothesis (hypothesis_create), or applying a mental model to a problem (mental_model_apply)."
            : "Pick ONE suggestion and execute the recommendedTool. After completing it, call suggest_next_action again to re-evaluate.",
      });
    }),
  );
}

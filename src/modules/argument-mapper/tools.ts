import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createArgument,
  getArgument,
  addNode,
  updateArgument,
  listArguments,
  completeArgument,
  challengeArgument,
} from "./services.js";

export function registerArgumentMapperTools(server: McpServer): void {
  server.tool(
    "argument_create",
    "Create a new argument to map — start with a topic and optionally an initial conclusion",
    {
      topic: z.string().max(1000).describe("The topic or question being argued"),
      conclusion: z.string().max(2000).optional().describe("Initial conclusion (can be refined later)"),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
    },
    async ({ topic, conclusion, tags }) => {
      const argument = createArgument(topic, conclusion, tags);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(argument, null, 2) }],
      };
    },
  );

  server.tool(
    "argument_add_node",
    "Add a node to an argument — claims, evidence, rebuttals, qualifiers, or counter-arguments form the tree structure",
    {
      argument_id: z.string().describe("ID of the argument"),
      type: z
        .enum(["claim", "evidence", "rebuttal", "qualifier", "counter"])
        .describe("Node type: claim (assertion), evidence (supporting data), rebuttal (response to counter), qualifier (limiting condition), counter (opposing argument)"),
      content: z.string().max(5000).describe("Content of this node"),
      parent_node_id: z
        .string()
        .optional()
        .describe("ID of parent node — omit for root-level nodes"),
      strength: z
        .enum(["weak", "medium", "strong"])
        .default("medium")
        .describe("Strength of this node (default: medium)"),
      source: z.string().max(500).optional().describe("Source or citation for this node"),
    },
    async ({ argument_id, type, content, parent_node_id, strength, source }) => {
      try {
        const node = addNode(argument_id, type, content, parent_node_id, strength, source);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(node, null, 2) }],
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
    "argument_view",
    "View a full argument with its tree-structured nodes — the main tool for reading argument maps",
    {
      argument_id: z.string().describe("ID of the argument"),
    },
    async ({ argument_id }) => {
      const result = getArgument(argument_id);
      if (!result) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `Argument not found: ${argument_id}` }, null, 2),
            },
          ],
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    "argument_update",
    "Update an argument's topic, conclusion, or tags",
    {
      argument_id: z.string().describe("ID of the argument"),
      topic: z.string().max(1000).optional().describe("Updated topic"),
      conclusion: z.string().max(2000).optional().describe("Updated conclusion"),
      tags: z.array(z.string()).optional().describe("Updated tags"),
    },
    async ({ argument_id, topic, conclusion, tags }) => {
      try {
        const argument = updateArgument(argument_id, { topic, conclusion, tags });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(argument, null, 2) }],
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
    "argument_complete",
    "Mark an argument as complete with a final conclusion",
    {
      argument_id: z.string().describe("ID of the argument"),
      conclusion: z.string().max(2000).describe("Final conclusion of the argument"),
    },
    async ({ argument_id, conclusion }) => {
      try {
        const argument = completeArgument(argument_id, conclusion);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(argument, null, 2) }],
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
    "argument_challenge",
    "Mark an argument as challenged — flag it for re-evaluation when the conclusion is disputed",
    {
      argument_id: z.string().describe("ID of the argument to challenge"),
    },
    async ({ argument_id }) => {
      try {
        const argument = challengeArgument(argument_id);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(argument, null, 2) }],
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
    "argument_list",
    "List arguments with optional status and tag filters",
    {
      status: z
        .enum(["building", "complete", "challenged", "all"])
        .default("all")
        .describe("Filter by status (default: all)"),
      tags: z.array(z.string()).optional().describe("Filter by tags (any match)"),
    },
    async ({ status, tags }) => {
      const argumentList = listArguments(status, tags);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { count: argumentList.length, arguments: argumentList },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}

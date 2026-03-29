import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  addBelief,
  getBelief,
  updateBelief,
  listBeliefs,
  reportContradiction,
  resolveContradiction,
  acceptContradiction,
  listContradictions,
  findPotentialContradictions,
} from "./services.js";

export function registerContradictionDetectorTools(server: McpServer): void {
  server.tool(
    "belief_add",
    "Record a belief — a statement you hold to be true, possibly in a specific domain",
    {
      statement: z.string().max(2000).describe("The belief statement"),
      domain: z.string().max(200).optional().describe("Domain or topic area (e.g. 'software design', 'economics')"),
      confidence: z
        .number()
        .min(0)
        .max(1)
        .default(0.5)
        .describe("Confidence in this belief 0-1 (default: 0.5)"),
      source: z.string().max(500).optional().describe("Where this belief comes from"),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
    },
    async ({ statement, domain, confidence, source, tags }) => {
      const belief = addBelief(statement, domain, confidence, source, tags);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(belief, null, 2) }],
      };
    },
  );

  server.tool(
    "belief_list",
    "List beliefs with optional domain or tag filters",
    {
      domain: z.string().max(200).optional().describe("Filter by domain"),
      tags: z.array(z.string()).optional().describe("Filter by tags (any match)"),
    },
    async ({ domain, tags }) => {
      const beliefList = listBeliefs(domain, tags);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { count: beliefList.length, beliefs: beliefList },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "belief_update",
    "Update a belief's statement, domain, confidence, source, or tags",
    {
      belief_id: z.string().describe("ID of the belief"),
      statement: z.string().max(2000).optional().describe("Updated statement"),
      domain: z.string().max(200).optional().describe("Updated domain"),
      confidence: z.number().min(0).max(1).optional().describe("Updated confidence 0-1"),
      source: z.string().max(500).optional().describe("Updated source"),
      tags: z.array(z.string()).optional().describe("Updated tags"),
    },
    async ({ belief_id, statement, domain, confidence, source, tags }) => {
      try {
        const belief = updateBelief(belief_id, { statement, domain, confidence, source, tags });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(belief, null, 2) }],
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
    "contradiction_report",
    "Report a contradiction between two beliefs — record that two beliefs conflict with each other",
    {
      belief_a_id: z.string().describe("ID of the first belief"),
      belief_b_id: z.string().describe("ID of the second belief"),
      explanation: z.string().max(5000).describe("Explanation of why these beliefs contradict"),
    },
    async ({ belief_a_id, belief_b_id, explanation }) => {
      try {
        const result = reportContradiction(belief_a_id, belief_b_id, explanation);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
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
    "contradiction_resolve",
    "Mark a contradiction as resolved with an explanation of how it was reconciled",
    {
      contradiction_id: z.string().describe("ID of the contradiction"),
      resolution: z.string().max(5000).describe("How the contradiction was resolved"),
    },
    async ({ contradiction_id, resolution }) => {
      try {
        const contradiction = resolveContradiction(contradiction_id, resolution);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(contradiction, null, 2) }],
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
    "contradiction_accept",
    "Accept a contradiction as a known paradox that doesn't need resolution",
    {
      contradiction_id: z.string().describe("ID of the contradiction to accept"),
    },
    async ({ contradiction_id }) => {
      try {
        const contradiction = acceptContradiction(contradiction_id);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(contradiction, null, 2) }],
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
    "contradiction_list",
    "List contradictions with optional status filter",
    {
      status: z
        .enum(["unresolved", "resolved", "accepted", "all"])
        .default("unresolved")
        .describe("Filter by status (default: unresolved)"),
    },
    async ({ status }) => {
      const contradictionList = listContradictions(status);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { count: contradictionList.length, contradictions: contradictionList },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "contradiction_find_candidates",
    "Find potential contradictions for a belief by returning same-domain beliefs for semantic evaluation — caller evaluates whether they conflict",
    {
      belief_id: z.string().describe("ID of the belief to find potential contradictions for"),
    },
    async ({ belief_id }) => {
      try {
        const candidates = findPotentialContradictions(belief_id);
        const target = candidates.length > 0
          ? { message: "Use belief_id to look up the target belief, then evaluate each candidate for semantic contradiction" }
          : { message: "No same-domain candidates found" };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  belief_id,
                  candidate_count: candidates.length,
                  note: "These are domain-overlap candidates — evaluate each for semantic contradiction",
                  ...target,
                  candidates,
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
}

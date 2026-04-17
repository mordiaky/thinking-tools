import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createHypothesis,
  getHypothesis,
  addEvidence,
  updateHypothesis,
  listHypotheses,
  resolveHypothesis,
  getHypothesisHistory,
} from "./services.js";
import { updateConfidence } from "./bayesian.js";
import { toolOk, toolErr, wrapHandler } from "../../utils/tool-response.js";

export function registerHypothesisTools(server: McpServer): void {
  server.tool(
    "hypothesis_create",
    "Create a new hypothesis with an initial confidence level",
    {
      title: z.string().max(500).describe("Title of the hypothesis"),
      description: z.string().max(10000).describe("Detailed description of the hypothesis"),
      initial_confidence: z
        .number()
        .min(0)
        .max(1)
        .describe("Initial confidence level (0-1)"),
      tags: z
        .array(z.string().max(100))
        .max(50)
        .optional()
        .describe("Optional tags for categorization"),
      context: z
        .string()
        .max(10000)
        .optional()
        .describe("Optional context about why this hypothesis was formed"),
    },
    wrapHandler(async ({ title, description, initial_confidence, tags, context }) => {
      const hypothesis = createHypothesis(
        title,
        description,
        initial_confidence,
        tags,
        context,
      );

      return toolOk(hypothesis);
    }),
  );

  server.tool(
    "hypothesis_add_evidence",
    "Add evidence to a hypothesis and auto-update confidence via Bayesian update",
    {
      hypothesis_id: z.string().describe("ID of the hypothesis"),
      type: z
        .enum(["supporting", "contradicting", "neutral"])
        .describe("Type of evidence"),
      description: z.string().max(10000).describe("Description of the evidence"),
      weight: z
        .number()
        .min(0)
        .max(1)
        .default(0.5)
        .describe("Weight/strength of the evidence (0-1, default 0.5)"),
      source: z
        .string()
        .max(2000)
        .optional()
        .describe("Optional source of the evidence"),
    },
    wrapHandler(async ({ hypothesis_id, type, description, weight, source }) => {
      const hypothesis = getHypothesis(hypothesis_id);
      if (!hypothesis) {
        return toolErr("NOT_FOUND", `Hypothesis not found: ${hypothesis_id}`);
      }

      if (hypothesis.status !== "active") {
        return toolErr("INVALID_STATE", `Cannot add evidence to ${hypothesis.status} hypothesis`);
      }

      const confidenceBefore = hypothesis.confidence;
      const confidenceAfter = updateConfidence(confidenceBefore, type, weight);

      const ev = addEvidence(
        hypothesis_id,
        type,
        description,
        weight,
        source ?? null,
        confidenceBefore,
        confidenceAfter,
      );

      const updated = getHypothesis(hypothesis_id);

      return toolOk({
        evidence: ev,
        hypothesis: updated,
        confidence_change: {
          before: confidenceBefore,
          after: confidenceAfter,
          delta: +(confidenceAfter - confidenceBefore).toFixed(4),
        },
      });
    }),
  );

  server.tool(
    "hypothesis_update",
    "Manually update hypothesis fields (confidence, description, tags)",
    {
      hypothesis_id: z.string().describe("ID of the hypothesis"),
      confidence: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("New confidence level (0-1)"),
      description: z
        .string()
        .max(10000)
        .optional()
        .describe("Updated description"),
      tags: z
        .array(z.string().max(100))
        .max(50)
        .optional()
        .describe("Updated tags"),
    },
    wrapHandler(async ({ hypothesis_id, confidence, description, tags }) => {
      const hypothesis = getHypothesis(hypothesis_id);
      if (!hypothesis) {
        return toolErr("NOT_FOUND", `Hypothesis not found: ${hypothesis_id}`);
      }

      const updates: { confidence?: number; description?: string; tags?: string[] } = {};
      if (confidence !== undefined) updates.confidence = confidence;
      if (description !== undefined) updates.description = description;
      if (tags !== undefined) updates.tags = tags;

      const updated = updateHypothesis(hypothesis_id, updates);

      return toolOk(updated);
    }),
  );

  server.tool(
    "hypothesis_list",
    "List hypotheses ranked by chosen field, with optional filtering",
    {
      status: z
        .enum(["active", "confirmed", "rejected", "all"])
        .default("active")
        .describe("Filter by status (default: active)"),
      sort_by: z
        .enum(["confidence", "created", "updated"])
        .default("confidence")
        .describe("Sort field (default: confidence)"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Filter by tags (matches any)"),
    },
    wrapHandler(async ({ status, sort_by, tags }) => {
      const hypothesesList = listHypotheses(status, sort_by, tags);

      return toolOk({
        count: hypothesesList.length,
        hypotheses: hypothesesList,
      });
    }),
  );

  server.tool(
    "hypothesis_resolve",
    "Mark a hypothesis as confirmed or rejected with final evidence",
    {
      hypothesis_id: z.string().describe("ID of the hypothesis"),
      resolution: z
        .enum(["confirmed", "rejected"])
        .describe("Resolution outcome"),
      final_evidence: z
        .string()
        .max(10000)
        .describe("Final evidence supporting the resolution"),
      confidence: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Optional final confidence (defaults to 0.99 for confirmed, 0.01 for rejected)"),
    },
    wrapHandler(async ({ hypothesis_id, resolution, final_evidence, confidence }) => {
      const hypothesis = getHypothesis(hypothesis_id);
      if (!hypothesis) {
        return toolErr("NOT_FOUND", `Hypothesis not found: ${hypothesis_id}`);
      }

      if (hypothesis.status !== "active") {
        return toolErr("INVALID_STATE", `Hypothesis already resolved as ${hypothesis.status}`);
      }

      const resolved = resolveHypothesis(
        hypothesis_id,
        resolution,
        final_evidence,
        confidence,
      );

      return toolOk(resolved);
    }),
  );

  server.tool(
    "hypothesis_history",
    "Get full audit trail for a hypothesis: evidence, confidence changes, resolution",
    {
      hypothesis_id: z.string().describe("ID of the hypothesis"),
    },
    wrapHandler(async ({ hypothesis_id }) => {
      const { hypothesis, events } = getHypothesisHistory(hypothesis_id);

      if (!hypothesis) {
        return toolErr("NOT_FOUND", `Hypothesis not found: ${hypothesis_id}`);
      }

      return toolOk({
        hypothesis,
        timeline: events,
      });
    }),
  );
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolOk, toolErr, wrapHandler } from "../../utils/tool-response.js";
import { saveScore } from "./services/scoring.js";
import { saveCritique } from "./services/critique.js";
import { getStoredIdeaSummaries, recordDuplicateCheck } from "./services/deduplication.js";
import { generateIdeas } from "./services/generation.js";
import { searchIdeas, getRecentIdeas, getAllIdeaSummaries, deleteRejectedIdea } from "./services/retrieval.js";
import { getIdeaForPlanning, saveMvpPlan, MvpStep } from "./services/action-plan.js";
import { deletePattern } from "./services/rejection-patterns.js";
import { getMutationContext, recordMutation } from "./services/mutation.js";
import { getResurfaceCandidates, markRevalidated } from "./services/resurface.js";
import { rescoreIdea, getRescoreContext, getScoreHistory } from "./services/rescore.js";
import { checkFermentationAlerts } from "./services/fermentation.js";
import { getRefinementContext, createRefinedVariant } from "./services/refinement.js";
import { getDecompositionContext, saveDecomposition } from "./services/decomposition.js";
import { db } from "../../db/client.js";
import { ideas, ideaRuns, tags, ideaTags } from "../../db/schema.js";
import { eq, sql } from "drizzle-orm";

export function registerIdeaLabTools(server: McpServer): void {
  server.tool(
    "idea_lab_generate_ideas",
    "Generate a batch of 5-8 software idea candidates using distinct ideation techniques. Returns generation instructions for each candidate plus the full pipeline steps. After calling this, follow the pipeline: for each candidate, call save_idea (with full content + runId), then score_idea, critique_idea, and check_duplicate. Finally, promote top 1-2 scorers to shortlisted. Read the software-only constraints resource first.",
    {
      domain: z.string().optional().describe("Domain seed (e.g., 'developer tooling', 'fintech')"),
      problemArea: z
        .string()
        .optional()
        .describe("Problem area to focus on (e.g., 'onboarding friction', 'async communication')"),
      candidateCount: z
        .number()
        .int()
        .min(5)
        .max(8)
        .optional()
        .describe("Number of candidates to generate (5-8, default 5)"),
      technique: z
        .string()
        .optional()
        .describe(
          "Force a specific technique for all candidates. Options: cross-domain-transfer, forced-analogy, contradiction-search, morphological-matrix. Omit for automatic rotation.",
        ),
      diversify: z
        .boolean()
        .optional()
        .describe(
          "When true, steers generation toward underrepresented domains in the portfolio. Uses portfolio analysis to identify gaps.",
        ),
    },
    wrapHandler(async (args) => {
      const result = await generateIdeas({
        domain: args.domain,
        problemArea: args.problemArea,
        candidateCount: args.candidateCount,
        forcedTechnique: args.technique,
        diversify: args.diversify,
      });

      const output = {
        runId: result.runId,
        candidateCount: result.candidateCount,
        softwareOnlyConstraint: result.softwareOnlyReminder,
        antiPatterns: result.antiPatterns,
        diversifyGuidance: result.diversifyGuidance,
        candidates: result.instructions.map((inst) => ({
          candidateNumber: inst.index + 1,
          technique: inst.technique.name,
          generationPrompt: inst.prompt,
          requiredFields: inst.requiredFields,
        })),
        pipeline: result.pipelineSteps,
      };

      return toolOk(output);
    }),
  );

  server.tool(
    "idea_lab_score_idea",
    "Score a single idea on 7 dimensions (novelty, usefulness, feasibility, testability, speed-to-MVP, defensibility, clarity) and compute a weighted composite score. IMPORTANT: Before calling this tool, read the scoring-rubric resource (idea-lab://rubric) to calibrate your scores using the anchor definitions. Each score must be 0-10. Provide 1-2 sentence reasoning per dimension explaining your score relative to the rubric anchors. Call this AFTER generation, BEFORE critique. Do NOT score in the same context as generation — use a fresh tool call.",
    {
      ideaId: z.string().uuid().describe("UUID of the idea to score"),
      scores: z.object({
        novelty: z.number().min(0).max(10).describe("Novelty score 0-10 per rubric anchors"),
        usefulness: z.number().min(0).max(10).describe("Usefulness score 0-10 per rubric anchors"),
        feasibility: z.number().min(0).max(10).describe("Feasibility score 0-10 per rubric anchors"),
        testability: z.number().min(0).max(10).describe("Testability score 0-10 per rubric anchors"),
        speedToMvp: z.number().min(0).max(10).describe("Speed-to-MVP score 0-10 per rubric anchors"),
        defensibility: z.number().min(0).max(10).describe("Defensibility score 0-10 per rubric anchors"),
        clarity: z.number().min(0).max(10).describe("Clarity score 0-10 per rubric anchors"),
      }),
      reasoning: z.object({
        novelty: z.string().describe("1-2 sentence reasoning for novelty score, referencing rubric anchors"),
        usefulness: z.string().describe("1-2 sentence reasoning for usefulness score"),
        feasibility: z.string().describe("1-2 sentence reasoning for feasibility score"),
        testability: z.string().describe("1-2 sentence reasoning for testability score"),
        speedToMvp: z.string().describe("1-2 sentence reasoning for speed-to-MVP score"),
        defensibility: z.string().describe("1-2 sentence reasoning for defensibility score"),
        clarity: z.string().describe("1-2 sentence reasoning for clarity score"),
      }),
      thresholds: z
        .object({
          feasibility: z.number().min(0).max(10).optional().describe("Override default feasibility threshold (default: 7)"),
          usefulness: z.number().min(0).max(10).optional().describe("Override default usefulness threshold (default: 7)"),
          novelty: z.number().min(0).max(10).optional().describe("Override default novelty threshold (default: 6)"),
          composite: z.number().min(0).max(10).optional().describe("Override default composite threshold (default: 6.5)"),
        })
        .optional()
        .describe("Optional per-run threshold overrides — omit to use config defaults"),
    },
    wrapHandler(async (args) => {
      const result = await saveScore({
        ideaId: args.ideaId,
        scores: args.scores,
        reasoning: args.reasoning,
        thresholds: args.thresholds,
      });
      return toolOk(result);
    }),
  );

  server.tool(
    "idea_lab_critique_idea",
    "Run adversarial critique on a single idea. You MUST argue AGAINST this idea — find every reason it should be rejected. Only truly strong ideas should survive. BEFORE calling this tool: 1) Use web search to look for existing products that solve the same problem — include URLs and product names in existingProducts. 2) Check if this is just a thin wrapper over an existing API. 3) Identify fragile dependencies. Rate the overall verdict: pass (strong idea survives scrutiny), weak (significant concerns but not fatal), or reject (fatal flaws found). Call this AFTER score_idea passes thresholds.",
    {
      ideaId: z.string().uuid().describe("UUID of the idea to critique"),
      findings: z.object({
        wrapperProblem: z
          .string()
          .nullable()
          .describe("Is this just a thin wrapper over an existing API/product? null if not applicable"),
        existingProducts: z
          .string()
          .nullable()
          .describe("Existing products that solve this problem — include URLs from web search. null if none found"),
        fragileDependencies: z
          .string()
          .nullable()
          .describe("Dependencies on APIs/services that could disappear or change terms? null if not applicable"),
        vagueStatement: z
          .string()
          .nullable()
          .describe("Is the problem statement vague or unmeasurable? null if problem is clear"),
        violatesSoftwareOnly: z
          .boolean()
          .describe("true if idea requires hardware, manufacturing, or lab work — this is a hard rejection"),
        overallVerdict: z
          .enum(["pass", "weak", "reject"])
          .describe("pass = survives harsh scrutiny, weak = concerns but not fatal, reject = fatal flaws"),
        verdictReasoning: z
          .string()
          .describe("1-3 sentence summary explaining the verdict — be specific about what's wrong or why it passes"),
      }),
    },
    wrapHandler(async (args) => {
      const result = await saveCritique({
        ideaId: args.ideaId,
        findings: args.findings,
      });
      return toolOk(result);
    }),
  );

  server.tool(
    "idea_lab_check_duplicate",
    "Check if an idea duplicates any stored idea. This tool uses a TWO-STEP process:\n\nSTEP 1: Call with only ideaId. The tool returns ALL stored idea summaries. Read each summary carefully.\n\nSTEP 2: Compare the new idea against every stored idea. 'Too similar' means same core problem AND same solution approach (not just same domain or similar tags). Variations on a theme are ALLOWED — only reject near-identical ideas. Then call this tool again with ideaId, isDuplicate, and duplicateOf array.\n\nCall this AFTER critique_idea passes. Do NOT use this to browse ideas — use search_ideas instead.",
    {
      ideaId: z.string().uuid().describe("UUID of the idea to check for duplicates"),
      isDuplicate: z
        .boolean()
        .optional()
        .describe("Omit on first call (Step 1). Set true/false on second call (Step 2) after comparing."),
      duplicateOf: z
        .array(
          z.object({
            storedIdeaId: z.string().uuid().describe("UUID of the stored idea this is too similar to"),
            reason: z.string().describe("Why this is too similar — be specific about overlapping problem + solution"),
            similarityLevel: z
              .enum(["identical", "near-identical", "same-core"])
              .describe("identical = same idea restated, near-identical = trivial variation, same-core = same problem+solution with different packaging"),
          }),
        )
        .optional()
        .describe("Omit on first call. Provide on second call if isDuplicate=true."),
    },
    wrapHandler(async (args) => {
      // Phase 1: Return stored idea summaries for comparison
      if (args.isDuplicate === undefined) {
        const summaries = await getStoredIdeaSummaries(args.ideaId);
        if (summaries.length === 0) {
          return toolOk({
            phase: "complete",
            isDuplicate: false,
            message: "No stored ideas to compare against. This is the first idea.",
            nextStep: "Call idea_lab_save_idea with this ideaId to persist the idea.",
          });
        }
        return toolOk({
          phase: "comparison_needed",
          ideaId: args.ideaId,
          storedIdeaCount: summaries.length,
          storedIdeas: summaries,
          instructions: "Compare the idea being checked against EACH stored idea above. 'Too similar' = same core problem AND same solution approach. Variations on a theme are allowed. Call check_duplicate again with isDuplicate=true/false and duplicateOf array if duplicates found.",
        });
      }

      // Phase 2: Record the comparison result
      const result = await recordDuplicateCheck({
        ideaId: args.ideaId,
        isDuplicate: args.isDuplicate,
        duplicateOf: args.duplicateOf,
      });
      return toolOk(result);
    }),
  );

  server.tool(
    "idea_lab_save_idea",
    "Save a new idea to the database with full structured content. Creates the idea record and returns its UUID. Call this FIRST in the per-candidate pipeline (before scoring), then use the returned ideaId for score_idea, critique_idea, and check_duplicate. Include runId if this is part of a generate_ideas batch.",
    {
      title: z.string().describe("Idea title — concise, specific"),
      oneLiner: z.string().describe("One sentence: what it does and for whom"),
      problem: z.string().describe("The problem this solves"),
      solution: z.string().describe("How the software solves it"),
      whyNow: z.string().optional().describe("Why this is viable now"),
      targetUser: z.string().optional().describe("Specific user archetype"),
      constraints: z.string().optional().describe("Technical or business constraints"),
      risks: z.string().optional().describe("Key risks"),
      mvpSteps: z.string().optional().describe("3-5 concrete MVP build steps"),
      domain: z.string().optional().describe("Domain category"),
      tags: z.array(z.string()).optional().describe("Semantic tags for categorization"),
      runId: z
        .string()
        .uuid()
        .optional()
        .describe("The idea_run this belongs to — for batch tracking and pass count"),
    },
    wrapHandler(async (args) => {
      // Insert new idea record
      const [inserted] = await db
        .insert(ideas)
        .values({
          title: args.title,
          oneLiner: args.oneLiner,
          problem: args.problem,
          solution: args.solution,
          whyNow: args.whyNow,
          targetUser: args.targetUser,
          constraints: args.constraints,
          risks: args.risks,
          mvpSteps: args.mvpSteps,
          domain: args.domain,
        })
        .returning({ id: ideas.id });

      const ideaId = inserted.id;

      // Handle tags if provided
      if (args.tags && args.tags.length > 0) {
        for (const tagName of args.tags) {
          // Upsert tag (insert if not exists, otherwise ignore)
          await db.insert(tags).values({ name: tagName }).onConflictDoNothing();
          // Fetch the tag id by name
          const [tagRecord] = await db
            .select({ id: tags.id })
            .from(tags)
            .where(eq(tags.name, tagName));
          if (tagRecord) {
            await db.insert(ideaTags).values({ ideaId, tagId: tagRecord.id }).onConflictDoNothing();
          }
        }
      }

      // Increment passCount on the parent run if runId provided
      if (args.runId) {
        await db
          .update(ideaRuns)
          .set({ passCount: sql`${ideaRuns.passCount} + 1` })
          .where(eq(ideaRuns.id, args.runId));
      }

      return toolOk({
        ideaId,
        status: "raw",
        runId: args.runId ?? null,
        nextStep:
          "Call idea_lab_score_idea with ideaId to score this idea. Read the scoring-rubric resource first.",
      });
    }),
  );

  server.tool(
    "idea_lab_search_ideas",
    "Search stored ideas by status, score range, domain, tags, or date range. Returns paginated summaries (title, one-liner, status, composite score, domain). For semantic search, provide semanticQuery to get all summaries for relevance judgment.",
    {
      status: z
        .enum(["raw", "shortlisted", "build-next", "rejected"])
        .optional()
        .describe("Filter by idea lifecycle status"),
      domain: z.string().optional().describe("Filter by domain (e.g., 'developer tooling')"),
      minScore: z.number().min(0).max(10).optional().describe("Minimum composite score filter"),
      maxScore: z.number().min(0).max(10).optional().describe("Maximum composite score filter"),
      tags: z.array(z.string()).optional().describe("Filter by tag names"),
      after: z.string().optional().describe("ISO date string — ideas created after this date"),
      before: z.string().optional().describe("ISO date string — ideas created before this date"),
      limit: z.number().int().min(1).max(50).default(10).describe("Maximum number of results to return (1-50)"),
      offset: z.number().int().min(0).default(0).describe("Pagination offset"),
      semanticQuery: z
        .string()
        .optional()
        .describe(
          "Semantic search query — returns ALL idea summaries for the caller to judge relevance. Overrides all other filters.",
        ),
    },
    wrapHandler(async (args) => {
      if (args.semanticQuery) {
        const allIdeas = await getAllIdeaSummaries();
        return toolOk({
          mode: "semantic_search",
          query: args.semanticQuery,
          instructions:
            "Read all idea summaries below and return only those semantically matching the query. Judge by conceptual similarity, not keyword overlap.",
          ideas: allIdeas,
        });
      }

      const rows = await searchIdeas(args);
      return toolOk({
        results: rows,
        count: rows.length,
        limit: args.limit,
        offset: args.offset,
      });
    }),
  );

  server.tool(
    "idea_lab_get_recent_ideas",
    "Retrieve the most recently created ideas, ordered by creation date descending. Excludes rejected ideas. Use this for a quick overview of latest ideas. For filtered queries, use search_ideas instead.",
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Maximum number of ideas to return (1-50)"),
    },
    wrapHandler(async (args) => {
      const rows = await getRecentIdeas(args.limit);
      return toolOk({ results: rows, count: rows.length });
    }),
  );

  server.tool(
    "idea_lab_promote_idea",
    "Change an idea's status through the lifecycle. Valid transitions: raw->shortlisted, raw->rejected, shortlisted->build-next, shortlisted->rejected, build-next->rejected. Use this after the full pipeline to promote top-scoring ideas to shortlisted.",
    {
      ideaId: z.string().uuid().describe("UUID of the idea to promote"),
      newStatus: z
        .enum(["raw", "shortlisted", "build-next", "rejected"])
        .describe("Target status for the idea"),
    },
    wrapHandler(async (args) => {
      // Fetch current idea status
      const rows = await db
        .select({ id: ideas.id, status: ideas.status })
        .from(ideas)
        .where(eq(ideas.id, args.ideaId));

      if (rows.length === 0) {
        return toolErr("NOT_FOUND", "Idea not found", { ideaId: args.ideaId });
      }

      const currentStatus = rows[0].status;

      // Validate lifecycle transition
      const validTransitions: Record<string, string[]> = {
        raw: ["shortlisted", "rejected"],
        shortlisted: ["build-next", "rejected"],
        "build-next": ["rejected"],
        rejected: [],
      };

      const allowed = validTransitions[currentStatus] ?? [];
      if (!allowed.includes(args.newStatus)) {
        return toolErr("INVALID_STATE", "Invalid status transition", {
          from: currentStatus,
          to: args.newStatus,
          validTransitions: allowed.length > 0 ? allowed : ["none — terminal state"],
        });
      }

      // Apply the transition
      await db
        .update(ideas)
        .set({ status: args.newStatus, updatedAt: new Date().toISOString() })
        .where(eq(ideas.id, args.ideaId));

      return toolOk({
        ideaId: args.ideaId,
        previousStatus: currentStatus,
        newStatus: args.newStatus,
        updatedAt: new Date().toISOString(),
      });
    }),
  );

  server.tool(
    "idea_lab_delete_idea",
    "Permanently delete a rejected idea and all associated data (scores, critiques, tags). Only works on ideas with status 'rejected'. This is irreversible.",
    {
      ideaId: z.string().uuid().describe("UUID of the rejected idea to delete"),
    },
    wrapHandler(async (args) => {
      const result = await deleteRejectedIdea(args.ideaId);
      if ("error" in result) {
        return toolErr("NOT_FOUND", result.error as string);
      }
      return toolOk(result);
    }),
  );

  server.tool(
    "idea_lab_remove_pattern",
    "Remove a false-positive rejection pattern from the immune memory. Use this when a stored anti-pattern is too broad or incorrect. Browse patterns first via the idea-lab://rejection-patterns resource.",
    {
      patternId: z.string().uuid().describe("UUID of the rejection pattern to remove"),
    },
    wrapHandler(async (args) => {
      const result = await deletePattern(args.patternId);
      if ("error" in result) {
        return toolErr("NOT_FOUND", result.error as string);
      }
      return toolOk(result);
    }),
  );

  server.tool(
    "idea_lab_mutate_idea",
    "Mutate a weak or rejected idea into a new variant by changing one axis (target user, scope, tech approach, or business model). TWO-STEP: Step 1 — call with ideaId only to get idea content, critique findings, and mutation context. Step 2 — call again with ideaId, axis, and full new idea fields to create the variant. Max mutation depth: 2 generations. Run the full pipeline (score, critique, dedup) on the new variant.",
    {
      ideaId: z.string().uuid().describe("UUID of the parent idea to mutate"),
      axis: z
        .enum(["target_user", "scope", "tech_approach", "business_model"])
        .optional()
        .describe("Which axis to mutate. Omit on Step 1 to get mutation context."),
      title: z.string().optional().describe("Title for the new variant idea"),
      oneLiner: z.string().optional().describe("One sentence: what the variant does and for whom"),
      problem: z.string().optional().describe("The problem this variant solves"),
      solution: z.string().optional().describe("How this variant solves it"),
      whyNow: z.string().optional().describe("Why this variant is viable now"),
      targetUser: z.string().optional().describe("Specific user archetype for the variant"),
      constraints: z.string().optional().describe("Technical or business constraints"),
      risks: z.string().optional().describe("Key risks for the variant"),
      domain: z.string().optional().describe("Domain category for the variant"),
      tags: z.array(z.string()).optional().describe("Semantic tags for the variant"),
    },
    wrapHandler(async (args) => {
      // Step 1: Return mutation context (no axis provided)
      if (args.axis === undefined) {
        const context = await getMutationContext(args.ideaId);
        if ("error" in context) {
          return toolErr("NOT_FOUND", context.error as string);
        }
        return toolOk({
          phase: "mutation_context",
          idea: context.idea,
          critique: context.critique,
          currentDepth: context.currentDepth,
          canMutate: context.canMutate,
          ...(context.depthMessage ? { depthMessage: context.depthMessage } : {}),
          instructions: context.canMutate
            ? "Choose a mutation axis (target_user, scope, tech_approach, business_model). Generate a new idea variant by changing the chosen axis while keeping the core insight. Then call mutate_idea again with ideaId, axis, and full new idea fields (title, oneLiner, problem, solution, targetUser, domain are required)."
            : "Mutation depth cap reached. Cannot mutate further. Max depth is 2 generations.",
          mutationAxes: {
            target_user: "Change who this is built for — different segment, role, or use case",
            scope: "Change the scope — narrower feature set, broader platform, or different problem boundary",
            tech_approach: "Change the technical implementation — different architecture, protocol, or tooling",
            business_model: "Change how value is captured — different pricing, delivery, or distribution model",
          },
        });
      }

      // Step 2: Create the variant idea
      if (!args.title || !args.oneLiner || !args.problem || !args.solution) {
        return toolErr("INVALID_INPUT", "Step 2 requires title, oneLiner, problem, and solution for the new variant idea");
      }

      // Validate depth cap before creating
      const context = await getMutationContext(args.ideaId);
      if ("error" in context) {
        return toolErr("NOT_FOUND", context.error as string);
      }

      if (!context.canMutate) {
        return toolErr("CONSTRAINT_VIOLATION", "Mutation depth cap reached", {
          depthMessage: context.depthMessage,
          currentDepth: context.currentDepth,
        });
      }

      const newDepth = context.currentDepth + 1;

      // Insert the new variant idea (same pattern as save_idea)
      const [inserted] = await db
        .insert(ideas)
        .values({
          title: args.title,
          oneLiner: args.oneLiner,
          problem: args.problem,
          solution: args.solution,
          whyNow: args.whyNow,
          targetUser: args.targetUser,
          constraints: args.constraints,
          risks: args.risks,
          domain: args.domain,
        })
        .returning({ id: ideas.id });

      const newIdeaId = inserted.id;

      // Handle tags if provided
      if (args.tags && args.tags.length > 0) {
        for (const tagName of args.tags) {
          await db.insert(tags).values({ name: tagName }).onConflictDoNothing();
          const [tagRecord] = await db
            .select({ id: tags.id })
            .from(tags)
            .where(eq(tags.name, tagName));
          if (tagRecord) {
            await db.insert(ideaTags).values({ ideaId: newIdeaId, tagId: tagRecord.id }).onConflictDoNothing();
          }
        }
      }

      // Record the mutation relationship
      await recordMutation(args.ideaId, newIdeaId, args.axis, newDepth);

      return toolOk({
        newIdeaId,
        parentId: args.ideaId,
        axis: args.axis,
        depth: newDepth,
        nextStep:
          "Run the full pipeline on the new idea: call idea_lab_score_idea (read rubric first), then idea_lab_critique_idea, then idea_lab_check_duplicate. After pipeline, promote with idea_lab_promote_idea.",
      });
    }),
  );

  server.tool(
    "idea_lab_resurface_ideas",
    "Resurface shortlisted ideas that haven't been reviewed in a while. Returns ideas older than N days (default 14) with their latest critique, score, current rejection patterns, and portfolio gaps. For each idea: re-run critique_idea with fresh web search, check against rejection patterns, compare to portfolio gaps. Do NOT re-score — historical scores are preserved. After review, call idea_lab_mark_revalidated for each idea. Max 5 ideas per call.",
    {
      daysOld: z
        .number()
        .int()
        .min(1)
        .default(14)
        .describe("Minimum age in days for ideas to resurface (default: 14)"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(5)
        .default(5)
        .describe("Maximum ideas to resurface (1-5, default 5)"),
    },
    wrapHandler(async (args) => {
      const result = await getResurfaceCandidates(args.daysOld, args.limit);
      return toolOk(result);
    }),
  );

  server.tool(
    "idea_lab_mark_revalidated",
    "Mark an idea as re-validated after a resurface review. Updates the re_validated_at timestamp. Call this after completing the resurface review for each idea (re-critique, pattern check, gap comparison). Does NOT change the idea's score or status.",
    {
      ideaId: z.string().uuid().describe("UUID of the idea that was re-evaluated"),
    },
    wrapHandler(async (args) => {
      const result = await markRevalidated(args.ideaId);
      if ("error" in result) {
        return toolErr("NOT_FOUND", result.error as string);
      }
      return toolOk(result);
    }),
  );

  server.tool(
    "idea_lab_generate_action_plan",
    "Generate a 3-5 step MVP action plan for a shortlisted or build-next idea. TWO-STEP process: Step 1 — call with ideaId only to get the idea content and plan format. Step 2 — generate the plan steps, then call again with ideaId AND planSteps to save. Each step must include tech stack, architecture approach, and timeline estimate. Only works on shortlisted or build-next ideas.",
    {
      ideaId: z.string().uuid().describe("UUID of the idea to plan"),
      planSteps: z
        .array(
          z.object({
            stepNumber: z.number().int().min(1).max(5),
            title: z.string(),
            description: z.string(),
            techStack: z.array(z.string()),
            architectureApproach: z.string(),
            timelineEstimate: z.string(),
          }),
        )
        .min(3)
        .max(5)
        .optional()
        .describe(
          "Omit on first call. Provide 3-5 detailed steps on second call to save the plan.",
        ),
    },
    wrapHandler(async (args) => {
      if (args.planSteps !== undefined) {
        // Step 2: save the plan
        const result = await saveMvpPlan(args.ideaId, args.planSteps as MvpStep[]);
        if ("error" in result) {
          return toolErr("INVALID_STATE", result.error as string);
        }
        return toolOk(result);
      }

      // Step 1: return idea content + instructions
      const result = await getIdeaForPlanning(args.ideaId);
      if ("error" in result) {
        return toolErr("NOT_FOUND", result.error as string);
      }
      return toolOk(result);
    }),
  );

  server.tool(
    "idea_lab_submit_idea",
    "Submit unstructured text containing one or more idea seeds. Returns the raw text with parsing instructions. After calling this, YOU (the caller) must: 1) Read the text and identify discrete idea candidates. 2) For each candidate, extract structured fields (title, oneLiner, problem, solution, domain, tags). 3) Call idea_lab_save_idea for each extracted idea. 4) Run the standard pipeline (score, critique, dedup) on each. This tool does NOT parse the text itself — it provides the text and instructions for you to parse.",
    {
      text: z.string().min(10).describe("Unstructured text containing idea seeds — brain dump, notes, conversation excerpt, etc."),
      source: z.string().optional().describe("Where this text came from (e.g., 'meeting notes', 'shower thought', 'article reaction')"),
    },
    async (args) => {
      const result = {
        rawText: args.text,
        source: args.source ?? "manual",
        instructions:
          "Identify each discrete idea in the raw text above. For each idea, extract the required fields and call idea_lab_save_idea. Then run the full pipeline on each saved idea: score_idea (read rubric first), critique_idea, check_duplicate. Promote top ideas with promote_idea.",
        requiredFieldsPerIdea: ["title", "oneLiner", "problem", "solution"],
        optionalFieldsPerIdea: ["whyNow", "targetUser", "constraints", "risks", "domain", "tags"],
        parsingGuidelines:
          "Split by distinct problem-solution pairs. One idea = one problem + one solution. If text describes multiple problems or multiple solutions to the same problem, split into separate ideas. Ignore meta-commentary, tangents, and non-idea content.",
      };

      return toolOk(result);
    },
  );

  server.tool(
    "idea_lab_refine_idea",
    "Refine a weak idea by applying an escalating constraint to force sharper focus. TWO-STEP process: Step 1 — call with ideaId only to get idea content, critique findings, score, and list of constraints. Step 2 — pick a constraint, generate a refined version that addresses critique weaknesses while satisfying the constraint, then call again with ideaId + constraint + all new idea fields. Creates a variant linked to the parent. Run the full pipeline (score, critique, dedup) on the new variant.",
    {
      ideaId: z.string().uuid().describe("UUID of the idea to refine"),
      constraint: z
        .enum(["weekend-buildable", "cli-only", "offline-only", "single-user-type", "no-dependencies", "api-only"])
        .optional()
        .describe("Constraint to apply. Omit on Step 1."),
      title: z.string().optional().describe("Title for the refined idea"),
      oneLiner: z.string().optional().describe("One sentence: what the refined idea does and for whom"),
      problem: z.string().optional().describe("The problem this refined idea solves"),
      solution: z.string().optional().describe("How the refined idea solves it"),
      whyNow: z.string().optional().describe("Why viable now"),
      targetUser: z.string().optional().describe("Specific user archetype"),
      constraints: z.string().optional().describe("Technical or business constraints"),
      risks: z.string().optional().describe("Key risks"),
      domain: z.string().optional().describe("Domain category"),
      tags: z.array(z.string()).optional().describe("Semantic tags"),
    },
    wrapHandler(async (args) => {
      // Step 1: Return refinement context (no constraint provided)
      if (args.constraint === undefined) {
        const context = await getRefinementContext(args.ideaId);
        if ("error" in context) {
          return toolErr("NOT_FOUND", context.error as string);
        }
        return toolOk(context);
      }

      // Step 2: Create the refined variant
      if (!args.title || !args.oneLiner || !args.problem || !args.solution) {
        return toolErr("INVALID_INPUT", "Step 2 requires title, oneLiner, problem, and solution for the refined idea");
      }

      const result = await createRefinedVariant(args.ideaId, args.constraint, {
        title: args.title,
        oneLiner: args.oneLiner,
        problem: args.problem,
        solution: args.solution,
        whyNow: args.whyNow,
        targetUser: args.targetUser,
        constraints: args.constraints,
        risks: args.risks,
        domain: args.domain,
        tags: args.tags,
      });

      if ("error" in result) {
        return toolErr("NOT_FOUND", result.error as string);
      }

      return toolOk(result);
    }),
  );

  server.tool(
    "idea_lab_decompose_idea",
    "Decompose a shortlisted or build-next idea into 3-7 independently shippable micro-ideas. TWO-STEP process: Step 1 — call with ideaId only to get idea content and decomposition guidance. Step 2 — break the idea into micro-ideas, then call again with ideaId + microIdeas array. Each micro-idea is saved as a variant linked to the parent. Run the full pipeline on each micro-idea afterward. Only works on shortlisted or build-next ideas.",
    {
      ideaId: z.string().uuid().describe("UUID of the idea to decompose"),
      microIdeas: z
        .array(
          z.object({
            title: z.string().describe("Micro-idea title"),
            oneLiner: z.string().describe("One sentence summary"),
            problem: z.string().describe("Specific problem this micro-idea solves"),
            solution: z.string().describe("How it solves it"),
            standaloneValue: z
              .string()
              .describe("Why this works as an independent product — what value does it deliver on its own?"),
            domain: z.string().optional().describe("Domain category"),
            tags: z.array(z.string()).optional().describe("Semantic tags"),
          }),
        )
        .min(3)
        .max(7)
        .optional()
        .describe("Omit on Step 1. Provide 3-7 micro-ideas on Step 2."),
    },
    wrapHandler(async (args) => {
      // Step 1: Return decomposition context (no microIdeas provided)
      if (args.microIdeas === undefined) {
        const context = await getDecompositionContext(args.ideaId);
        if ("error" in context) {
          return toolErr("NOT_FOUND", context.error as string);
        }
        return toolOk(context);
      }

      // Step 2: Save all micro-ideas
      const result = await saveDecomposition(args.ideaId, args.microIdeas);

      if ("error" in result) {
        return toolErr("INVALID_STATE", result.error as string);
      }

      return toolOk(result);
    }),
  );

  server.tool(
    "idea_lab_rescore_idea",
    "Rescore an existing idea with optional market context from web search. TWO-STEP: Step 1 (step='1') returns idea content and prior scores for research. Step 2 (step='2') accepts new scores + market findings and persists the rescore with delta display. Call after idea_lab_resurface_ideas identifies candidates. Do NOT use for initial scoring — use idea_lab_score_idea instead.",
    {
      ideaId: z.string().uuid().describe("UUID of the idea to rescore"),
      step: z.enum(["1", "2"]).describe("Step 1: get context and prior scores. Step 2: persist new scores."),
      scores: z
        .object({
          novelty: z.number().min(0).max(10),
          usefulness: z.number().min(0).max(10),
          feasibility: z.number().min(0).max(10),
          testability: z.number().min(0).max(10),
          speedToMvp: z.number().min(0).max(10),
          defensibility: z.number().min(0).max(10),
          clarity: z.number().min(0).max(10),
        })
        .optional()
        .describe("New dimension scores (required for step 2)"),
      reasoning: z
        .object({
          novelty: z.string(),
          usefulness: z.string(),
          feasibility: z.string(),
          testability: z.string(),
          speedToMvp: z.string(),
          defensibility: z.string(),
          clarity: z.string(),
        })
        .optional()
        .describe("Per-dimension reasoning (required for step 2)"),
      marketContext: z
        .string()
        .optional()
        .describe("Summary of web search findings: new competitors, tech changes, market shifts"),
    },
    wrapHandler(async (args) => {
      if (args.step === "1") {
        // Step 1: return idea content and prior scores for research
        const context = await getRescoreContext(args.ideaId);
        if ("error" in context) {
          return toolErr("NOT_FOUND", context.error as string);
        }
        return toolOk({
          phase: "rescore_context",
          idea: context.idea,
          priorScores: context.priorScores,
          instructions: `Search the web for: new competitors to "${context.idea.title}", recent tech changes affecting ${context.idea.domain ?? "this domain"}, market shifts in the problem space. Then call this tool again with step='2', providing updated scores, reasoning, and marketContext summarizing your findings.`,
        });
      }

      // Step 2: validate and persist rescore
      if (!args.scores || !args.reasoning) {
        return toolErr("INVALID_INPUT", "Step 2 requires scores and reasoning objects");
      }

      const result = await rescoreIdea({
        ideaId: args.ideaId,
        scores: args.scores,
        reasoning: args.reasoning,
        marketContext: args.marketContext,
      });

      return toolOk(result);
    }),
  );

  server.tool(
    "idea_lab_get_score_history",
    "Returns the complete score timeline for an idea, ordered chronologically. Each entry shows composite score, score type (initial/rescore), market context note, and delta vs previous score. Use to inspect an idea's trajectory before promoting or retiring it.",
    {
      ideaId: z.string().uuid().describe("UUID of the idea to retrieve score history for"),
      verbose: z
        .boolean()
        .optional()
        .default(false)
        .describe("When true, includes per-dimension reasoning and rubric snapshots"),
    },
    wrapHandler(async (args) => {
      const history = await getScoreHistory(args.ideaId);

      const output = history.map((entry) => {
        if (args.verbose) {
          return entry;
        }
        // Non-verbose: omit reasoning and rubricSnapshot
        const { reasoning: _reasoning, rubricSnapshot: _rubricSnapshot, ...rest } = entry;
        return rest;
      });

      return toolOk({ ideaId: args.ideaId, scoreCount: output.length, history: output });
    }),
  );

  server.tool(
    "idea_lab_check_fermentation_alerts",
    "Check for fermentation alerts — ideas whose scores crossed promotion thresholds during rescoring but are still in raw status. Returns up to N alerts sorted by significance. Alerts are marked as seen after retrieval. Call this at the start of ideation sessions to discover hidden gems. Pull-only — no background notifications.",
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .default(10)
        .describe("Maximum number of alerts to return (1-20, default 10)"),
    },
    wrapHandler(async (args) => {
      const result = await checkFermentationAlerts(args.limit);
      return toolOk(result);
    }),
  );
}

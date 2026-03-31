# Thinking Tools MCP Server

A unified MCP server suite for cognitive augmentation. 61 tools across 8 modules that make AI assistants significantly better at structured thinking, ideation, and decision-making.

## Why?

AI agents are great at generating text but terrible at structured reasoning. They don't track what they've investigated, can't weigh evidence systematically, and forget their assumptions between sessions. Thinking Tools fixes this by giving agents persistent, structured cognitive tools that survive across conversations.

## Modules

| Module | Tools | Standalone | Description |
|--------|-------|-----------|-------------|
| **Idea Lab** | 20 | [idea-lab-mcp](https://github.com/mordiaky/idea-lab-mcp) | Structured ideation pipeline — generate, score, critique, deduplicate, and store ideas |
| **Hypothesis Tracker** | 6 | [hypothesis-tracker-mcp](https://github.com/mordiaky/hypothesis-tracker-mcp) | Evidence-based belief tracking with Bayesian confidence updates |
| **Decision Matrix** | 8 | — | Weighted multi-criteria decisions with tradeoff analysis |
| **Mental Models** | 3 | — | Apply 12 reasoning frameworks (first-principles, pre-mortem, inversion, etc.) |
| **Assumption Tracker** | 5 | — | Surface, test, and resolve hidden assumptions |
| **Contradiction Detector** | 8 | — | Find conflicting beliefs and statements across modules |
| **Learning Journal** | 4 | — | Persistent mistake/insight log with pattern extraction |
| **Argument Mapper** | 7 | — | Structured pro/con trees with strength ratings |

> Individual modules are also available as standalone MCP servers if you only need one.

## Stack

- TypeScript + Node.js 22+
- MCP SDK (`@modelcontextprotocol/sdk` ^1.27.1)
- SQLite via `better-sqlite3` + `drizzle-orm`
- Zod for validation
- stdio transport

## Installation

```bash
git clone https://github.com/mordiaky/thinking-tools.git
cd thinking-tools
npm install
npm run build
```

### Register with Claude Code

```bash
claude mcp add thinking-tools -s user -- node /path/to/thinking-tools/build/server.js
```

Or for development:

```bash
claude mcp add thinking-tools -s user -- npx tsx /path/to/thinking-tools/src/server.ts
```

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `DB_PATH` | `~/.thinking-tools/thinking.db` | SQLite database location |

The database is auto-created on first use. No setup required.

## Example: Idea Generation Pipeline

```
1. Generate ideas for a domain:
   idea_lab_generate_ideas(domain="developer tools", count=8)

2. Score each idea (novelty, usefulness, feasibility, defensibility):
   idea_lab_score_idea(id="abc123")
   → composite: 7.2 — PASS

3. Critique survivors:
   idea_lab_critique_idea(id="abc123")
   → strengths, weaknesses, market analysis

4. Check for duplicates:
   idea_lab_check_duplicate(id="abc123")
   → no existing ideas within similarity threshold

5. Promote the best:
   idea_lab_promote_idea(id="abc123")
```

## Example: Debugging with Hypotheses

```
1. Create competing theories:
   hypothesis_create("Memory leak in WS handler", confidence=0.6)
   hypothesis_create("Slow DB queries", confidence=0.4)

2. Add evidence as you investigate:
   hypothesis_add_evidence(ws_id, type="supporting",
     description="Heap growing unbounded", weight=0.7)
   → confidence: 0.6 → 0.78

3. Next session — pick up where you left off:
   hypothesis_list() → WS leak at 78%, DB at 22%
```

## Development

```bash
npm run dev          # Run with tsx (hot reload)
npm run build        # Compile TypeScript
npm run db:generate  # Generate Drizzle migrations
npm test             # Run tests
```

## Related Projects

- [ClawDaemon MCP](https://github.com/mordiaky/clawdaemon-mcp) — Connect Claude Code to OpenClaw for 24/7 automation
- [OpenClaw](https://github.com/openclaw/openclaw) — The open-source AI agent platform these tools are built for

## License

MIT

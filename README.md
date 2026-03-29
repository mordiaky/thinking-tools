# Thinking Tools MCP Server

A unified MCP server suite for cognitive augmentation. 61 tools across 8 modules that make AI assistants significantly better at structured thinking, ideation, and decision-making.

## Modules

| Module | Tools | Description |
|--------|-------|-------------|
| **Idea Lab** | 20 | Structured ideation pipeline — generate, score, critique, deduplicate, and store software ideas |
| **Hypothesis Tracker** | 6 | Evidence-based belief tracking with Bayesian confidence updates |
| **Decision Matrix** | 8 | Weighted multi-criteria decisions with tradeoff analysis |
| **Mental Models** | 3 | Apply 12 reasoning frameworks (first-principles, pre-mortem, inversion, etc.) |
| **Assumption Tracker** | 5 | Surface, test, and resolve hidden assumptions |
| **Contradiction Detector** | 8 | Find conflicting beliefs and statements across modules |
| **Learning Journal** | 4 | Persistent mistake/insight log with pattern extraction |
| **Argument Mapper** | 7 | Structured pro/con trees with strength ratings |

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

## Development

```bash
npm run dev          # Run with tsx (hot reload)
npm run build        # Compile TypeScript
npm run db:generate  # Generate Drizzle migrations
npm test             # Run tests
```

## License

MIT

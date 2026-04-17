# Contributing to thinking-tools

Thanks for considering a contribution. A few quick notes to save time for
both of us.

## Getting set up

```bash
git clone https://github.com/mordiaky/thinking-tools.git
cd thinking-tools
npm install
npm run build
npm test
```

Requires Node.js 22+.

## Running locally against Claude Code

```bash
claude mcp add thinking-tools-dev -s user -- npx tsx /path/to/thinking-tools/src/server.ts
```

Changes are picked up on each invocation; no restart needed for schema-free
code edits. For schema changes, re-run migrations with `npm run db:migrate`.

## What to expect in a PR

- **CI must be green.** Build and tests run on every PR.
- **New tools need tests.** If you add a tool or change its wiring, add
  a test in `tests/`. The existing `tests/integrations.test.ts` is a
  good template — each test resets the DB in `beforeEach`.
- **Cross-module coupling goes in `src/modules/integrations/`.** The
  individual modules are intentionally decoupled from each other; the
  integrations module is the only place they meet.
- **No new schema migrations unless you have to.** The existing
  `context` columns accept JSON markers (see `encodeSource` /
  `parseSource`) and most cross-references can live there.

## Adding a new cognitive module

1. Create `src/modules/<name>/schema.ts` additions in `src/db/schema.ts`.
2. Add `services.ts` with the business logic (services throw on bad
   input, return hydrated records).
3. Add `tools.ts` with a `register<Name>Tools(server)` function using
   `toolOk` / `toolErr` / `wrapHandler` from `src/utils/tool-response.ts`.
4. Wire the registration call in `src/server.ts`.
5. Generate the migration: `npm run db:generate`.
6. Write at least one integration test.

## Style

- TypeScript strict mode is already on.
- Prefer the Drizzle query builder; only reach for raw SQL when the
  builder is too verbose (see `listHypotheses` for the one exception).
- Error messages should be specific and should not leak file paths or
  internal implementation details.
- No comments unless they explain non-obvious *why*.

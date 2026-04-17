# Changelog

All notable changes to thinking-tools will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-04-17

First public release.

### Added

- **Cross-module integration layer** (`src/modules/integrations/`). The
  8 thinking modules are now wired together in a single explicit place:
  - Promoting an idea to `shortlisted` or `build-next` auto-creates a
    tracked hypothesis seeded at the idea's latest composite score.
  - Critique findings (`fragileDependencies`, `existingProducts`)
    auto-spawn testable assumptions with appropriate impact levels.
  - New `decision_create_from_shortlist` tool pre-seeds a Decision with
    shortlisted ideas as options.
- **`suggest_next_action` meta-tool**. Scans state across every module
  and returns a prioritized list of concrete next moves (untested
  critical assumptions, unresolved contradictions, stale hypotheses,
  shortlists ready for decision, idea-lab pipeline gaps).
- **Integration test suite** covering the cross-module wiring end to
  end — 16 tests via vitest.
- MIT `LICENSE` file.
- `SECURITY.md` with disclosure policy and threat-model notes.
- `CHANGELOG.md` (this file).
- GitHub Actions CI workflow running build + test on every push and PR.

### Changed

- **All tool handlers now return a standardized response envelope**
  (`toolOk` / `toolErr` / `wrapHandler`) so uncaught throws become
  structured `isError: true` payloads instead of raw stack traces.
- Service layer hardened:
  - SQL-injection fix in `listHypotheses` status filter (was
    string-interpolated).
  - Input validation on `createHypothesis` confidence range,
    `updateConfidence` prior/weight range, and decision criterion
    weight.
  - `createHypothesis` now runs its two inserts in a SQLite
    transaction for atomicity.
  - Silent JSON-parse failures in tag parsers now log and fall back
    instead of failing silently.

### Security

- Ran full audit: no hardcoded secrets, no dangerous evals or shell
  invocations, no path-traversal on `DB_PATH`. All tool inputs are
  Zod-validated before reaching service logic.
- Upgraded transitive dependencies via `npm audit fix` where non-breaking.

## [0.1.0] - 2026-03-29

Initial development release.

- Unified 8 cognitive modules into one MCP server: Idea Lab,
  Hypothesis Tracker, Decision Matrix, Mental Models, Assumption
  Tracker, Contradiction Detector, Learning Journal, Argument Mapper.
- 61 tools total, SQLite + drizzle storage, stdio transport.

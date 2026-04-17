# Security

## Reporting a Vulnerability

If you believe you have found a security vulnerability in thinking-tools,
please report it privately.

- **Preferred:** open a [GitHub Security Advisory](https://github.com/mordiaky/thinking-tools/security/advisories/new)
- **Alternative:** open a private issue and tag it `security`

Please do **not** open a public issue for suspected vulnerabilities.

## Scope and Threat Model

thinking-tools runs as a local MCP server over stdio. It has no network
listener, no authentication layer, and reads/writes a SQLite file in the
user's home directory by default (`~/.thinking-tools/thinking.db`).

The relevant threat surface is:

1. **Malicious tool arguments** arriving over the MCP stdio channel — the
   server validates every tool input with Zod schemas and parameterizes
   every SQL query (including raw queries in `listHypotheses`).
2. **Database file permissions** — the SQLite file inherits the umask of
   the user running the server. Set `DB_PATH` to a non-default path if
   you need stricter permissions or a read-only mount.
3. **Cross-module data** — records in `assumptions`, `hypotheses`, and
   `decisions` link back to source records via JSON-encoded `context`
   fields. IDs embedded in these fields are UUIDs validated by Zod at
   the tool boundary before they reach any service function.

## Known Advisories

`npm audit` currently reports 4 moderate advisories against the
`esbuild -> @esbuild-kit/* -> drizzle-kit` dev-dependency chain. These
advisories apply to esbuild's development HTTP server; drizzle-kit uses
esbuild only for migration codegen and does not run that server. The
advisories do not affect the published MCP server or its runtime
dependencies.

No production dependencies have open advisories.

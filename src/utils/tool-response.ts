/**
 * Standardized MCP tool response helpers.
 *
 * Every tool handler should use `toolOk` for success and `toolErr` for errors.
 * This ensures:
 *   - Consistent JSON envelope (`{ type: "text", text: ... }`)
 *   - `isError: true` is always set on failures
 *   - Error messages are structured (code + message + optional details)
 *   - Claude gets clear, actionable error text instead of raw stack traces
 */

/** Shape returned by every tool handler. */
export interface ToolResponse {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
}

/** Standard error codes used across all modules. */
export type ErrorCode =
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "INVALID_INPUT"
  | "CONSTRAINT_VIOLATION"
  | "INTERNAL_ERROR";

/** Build a successful tool response. */
export function toolOk(data: unknown): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

/** Build an error tool response. Always sets `isError: true`. */
export function toolErr(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ToolResponse {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: code, message, ...details }, null, 2),
      },
    ],
    isError: true,
  };
}

/**
 * Wrap a tool handler so any unhandled throw becomes a structured error.
 * Use for handlers where service functions throw on bad input.
 *
 *   server.tool("name", "desc", schema, wrapHandler(async (args) => { ... }));
 */
export function wrapHandler<T>(
  fn: (args: T) => Promise<ToolResponse>,
): (args: T) => Promise<ToolResponse> {
  return async (args: T) => {
    try {
      return await fn(args);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);
      console.error(`[thinking-tools] Tool error: ${message}`);
      return toolErr("INTERNAL_ERROR", message);
    }
  };
}

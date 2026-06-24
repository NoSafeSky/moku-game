/**
 * @file mcp plugin — API factory.
 *
 * Exposes the mcp plugin's public surface (isRunning, httpEndpoint, toolNames).
 * All values are read from the per-instance McpHandle stored in the module-level
 * WeakMap (exported from lifecycle.ts), mirroring the loop plugin's api.ts pattern.
 */
import { mcpRegistry } from "./lifecycle";
import type { Api, McpApiContext } from "./types";

/**
 * Creates the mcp plugin API surface.
 *
 * The three methods read from the McpHandle stored in the module WeakMap keyed
 * on ctx.global. Before onStart or after onStop (no WeakMap entry) they degrade
 * gracefully: isRunning → false, httpEndpoint → undefined, toolNames → [].
 *
 * @param ctx - Minimal context providing only the global registry key.
 * @param ctx.global - Global plugin registry (key for the module WeakMap).
 * @returns The mcp {@link Api} object.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * api.isRunning();       // → true after start
 * api.httpEndpoint();    // → undefined (stdio-only) or "http://127.0.0.1:3333/mcp"
 * api.toolNames();       // → ["ecs:spawn", "ecs:query", ...]
 * ```
 */
export const createApi = (ctx: McpApiContext): Api => ({
  /**
   * Returns true while the MCP server is connected and listening.
   *
   * @returns Whether the server is running.
   * @example
   * ```ts
   * if (app.mcp.isRunning()) console.log("MCP ready");
   * ```
   */
  isRunning(): boolean {
    return mcpRegistry.get(ctx.global)?.running ?? false;
  },

  /**
   * Returns the HTTP endpoint URL, or undefined when HTTP transport is not active.
   *
   * @returns The endpoint URL string (e.g. "http://127.0.0.1:3333/mcp"), or undefined.
   * @example
   * ```ts
   * const endpoint = app.mcp.httpEndpoint();
   * ```
   */
  httpEndpoint(): string | undefined {
    return mcpRegistry.get(ctx.global)?.httpEndpoint ?? undefined;
  },

  /**
   * Returns the names of all registered MCP tools.
   *
   * @returns Read-only array of tool name strings.
   * @example
   * ```ts
   * app.mcp.toolNames(); // → ["ecs:spawn", "ecs:query", ...]
   * ```
   */
  toolNames(): readonly string[] {
    return mcpRegistry.get(ctx.global)?.toolNames ?? [];
  }
});

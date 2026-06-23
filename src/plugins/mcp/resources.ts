/**
 * @file mcp plugin — resource registration (read-only runtime snapshots: stats, entities, scene).
 */

/**
 * Registers the read-only MCP resources that expose live runtime state to agent clients.
 *
 * @param _server - The MCP server to register resources on.
 * @param _deps - Runtime dependencies (ecs, loop, scene) the resources read from.
 * @example
 * ```ts
 * registerResources(server, { ecs, loop, scene });
 * ```
 */
export function registerResources(_server: unknown, _deps: unknown): void {
  throw new Error("not implemented");
}

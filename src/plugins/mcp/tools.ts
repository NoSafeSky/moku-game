/**
 * @file mcp plugin — tool registration (entity/component/scene mutations via the command buffer).
 */

/**
 * Registers the MCP tools that mutate the runtime, routing structural ops through the ECS command buffer.
 *
 * @param _server - The MCP server to register tools on.
 * @param _deps - Runtime dependencies (ecs, scheduler, scene, loop) the tools operate against.
 * @example
 * ```ts
 * registerTools(server, { ecs, scheduler, scene, loop });
 * ```
 */
export function registerTools(_server: unknown, _deps: unknown): void {
  throw new Error("not implemented");
}

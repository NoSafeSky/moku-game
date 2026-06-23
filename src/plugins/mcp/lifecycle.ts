/**
 * @file mcp plugin — lifecycle (onStart/onStop) skeleton.
 */

/**
 * Starts the mcp plugin's managed resource.
 *
 * @param _ctx - Plugin context (config, state, require, global).
 * @example
 * ```ts
 * await start(ctx);
 * ```
 */
export async function start(_ctx: unknown): Promise<void> {
  throw new Error("not implemented");
}

/**
 * Stops the mcp plugin's managed resource. Reads its handle from the module WeakMap via ctx.global.
 *
 * @param _ctx - Teardown context ({ global } only).
 * @example
 * ```ts
 * await stop(ctx);
 * ```
 */
export async function stop(_ctx: unknown): Promise<void> {
  throw new Error("not implemented");
}

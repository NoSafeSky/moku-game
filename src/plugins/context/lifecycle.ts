/**
 * @file context plugin — onStart lifecycle skeleton.
 *
 * Binds the well-known resources (Assets, GameContext) onto the ECS world at start.
 */

/**
 * Binds Assets + GameContext resources onto the ECS world. No-op in the skeleton —
 * the binding (world.setResource of the assets API and the curated game context) is
 * implemented during the Cycle 2 build wave (Wave B). Kept as a no-op so the shipped
 * app boots; it never throws on the start path.
 *
 * @param _ctx - Plugin context (config, log, emit, env, require) — unused in skeleton.
 * @example
 * ```ts
 * await start(ctx);
 * ```
 */
export async function start(_ctx: unknown): Promise<void> {
  // Wave B binds: world.setResource(Assets, assetsApi) + world.setResource(GameContext, { log, emit, env }).
}

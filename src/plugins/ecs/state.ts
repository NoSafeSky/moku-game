/**
 * @file ecs plugin — state factory.
 *
 * Creates the single World instance that lives for the plugin's lifetime.
 * The world is constructed eagerly (not lazily) so `ctx.state.world` is
 * available synchronously from the moment the plugin initialises.
 */

import type { Config, State } from "./types";
import { createWorld } from "./world";

/**
 * Creates the initial ecs plugin state, constructing the World with the resolved config.
 *
 * @param ctx - Minimal context with global registry and resolved plugin configuration.
 * @param ctx.global - Global plugin registry (unused by ecs; present for context-tier compliance).
 * @param ctx.config - Resolved plugin configuration (`initialCapacity`, `maxStructuralOpsWarn`).
 * @returns The ecs state object containing the single World instance.
 * @example
 * ```ts
 * const state = createState({ global: {}, config: { initialCapacity: 1024, maxStructuralOpsWarn: 0 } });
 * state.world.spawn();
 * ```
 */
export function createState(ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State {
  const world = createWorld(ctx.config);
  return { world };
}

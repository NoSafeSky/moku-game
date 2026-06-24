/**
 * @file mcp plugin — state factory.
 *
 * Returns the initial mcp plugin state. Frame stats start at zero and are
 * updated each render tick by the lightweight stats probe system registered
 * in lifecycle.ts during onStart.
 */
import type { Config, State } from "./types";

/**
 * Creates the initial mcp plugin state.
 *
 * Stats fields are initialised to zero; the stats probe system registered
 * on the render stage updates them each frame.
 *
 * @param _ctx - Minimal context with global and config (unused — state has no config deps).
 * @param _ctx.global - Global plugin registry.
 * @param _ctx.config - Resolved plugin configuration.
 * @returns The initial {@link State} with zeroed stats.
 * @example
 * ```ts
 * const state = createState({ global: {}, config: defaultConfig });
 * // → { stats: { frame: 0, lastDt: 0, entityCount: 0 } }
 * ```
 */
export const createState = (_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State => ({
  stats: { frame: 0, lastDt: 0, entityCount: 0 }
});

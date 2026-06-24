/**
 * @file loop plugin — state factory.
 */
import type { Config, State } from "./types";

/**
 * Creates the initial loop plugin state.
 *
 * The loop starts paused: `running` is false, the accumulator is zero, and
 * `lastTime` is undefined (seeded on the first rAF callback).
 *
 * @param _ctx - Minimal context; config and global are available but unused
 *   because the initial state is always the same fixed shape.
 * @param _ctx.global - Global plugin registry (unused for initial state).
 * @param _ctx.config - Resolved plugin configuration (unused for initial state).
 * @returns The initial {@link State} object for this plugin instance.
 * @example
 * ```ts
 * const state = createState({ global: Object.freeze({}), config: defaultConfig });
 * // → { running: false, accumulator: 0, lastTime: undefined }
 * ```
 */
export const createState = (_ctx: {
  readonly global: object;
  readonly config: Readonly<Config>;
}): State => ({
  running: false,
  accumulator: 0,
  lastTime: undefined
});

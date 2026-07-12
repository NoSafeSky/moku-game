/**
 * @file tween plugin — state factory.
 *
 * Creates the initial mutable tween state: an empty active-tween registry, a
 * monotonic id source at zero, and `started: false` (the API creators no-op until
 * onStart registers the advance system and flips this flag).
 */
import type { Config, State } from "./types";

/**
 * Creates the initial tween plugin state.
 *
 * @param _ctx - Minimal context providing global registry and resolved config.
 * @param _ctx.global - Global plugin registry (unused; required by the kernel).
 * @param _ctx.config - Resolved tween configuration (unused at creation; defaults apply per-tween in the API).
 * @returns The initial tween state with an empty registry, `nextId: 0`, and `started: false`.
 * @example
 * ```ts
 * const state = createState({ global: {}, config: defaultConfig });
 * state.tweens; // Map {}
 * state.nextId; // 0
 * state.started; // false
 * ```
 */
export const createState = (_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State => ({
  tweens: new Map(),
  nextId: 0,
  started: false
});

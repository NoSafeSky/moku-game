/**
 * @file hierarchy plugin — state factory.
 *
 * The plugin holds no external resource: only the started flag, the Node component token defined
 * at onStart, and a lazily-rebuilt sibling-order memo.
 */
import type { Config, State } from "./types";

/**
 * Creates the initial hierarchy state (`started: false`, no Node token yet; the order memo fills
 * lazily on the first derived read).
 *
 * @param _ctx - Minimal context with global and config. Unused; present for compatibility with
 *   the Moku `createState` signature — initial state does not depend on config.
 * @param _ctx.global - Global plugin registry (unused).
 * @param _ctx.config - Resolved plugin configuration (unused).
 * @returns Fresh hierarchy state (`{ started: false, nodeToken: undefined }`).
 * @example
 * ```ts
 * const state = createState({ global: {}, config: { maxDepth: 64 } });
 * state.started; // false
 * ```
 */
export const createState = (_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State => ({
  started: false,
  nodeToken: undefined
});

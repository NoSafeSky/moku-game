/**
 * @file editor-history plugin — state factory.
 *
 * The two stacks (`undo`/`redo`) plus the open-gesture buffer. All live in-memory;
 * editor-history owns no external resource.
 */
import type { Config, State } from "./types";

/**
 * Creates the initial editor-history plugin state: both stacks empty, no open gesture.
 *
 * @param _ctx - Minimal context with global and config (config is unused — the
 *   initial state carries no config-derived field; `maxDepth` is read at eviction
 *   time instead, in `history.ts`).
 * @param _ctx.global - Global plugin registry.
 * @param _ctx.config - Resolved plugin configuration.
 * @returns The initial {@link State}.
 * @example
 * ```ts
 * const state = createState({ global: {}, config: { maxDepth: 100 } });
 * // → { undo: [], redo: [], gesture: undefined, gestureActive: false }
 * ```
 */
export function createState(_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State {
  return { undo: [], redo: [], gesture: undefined, gestureActive: false };
}

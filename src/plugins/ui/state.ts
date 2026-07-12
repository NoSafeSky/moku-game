/**
 * @file ui plugin — state factory.
 *
 * Creates the initial mutable ui state. `root` is absent until onStart captures the
 * renderer stage and builds the root (and stays `undefined` when headless); the
 * screen stack + HUD start empty; edge-detection counters start zeroed and `nextId`
 * starts at 1 so handle ids are always truthy.
 */
import type { Config, State } from "./types";

/**
 * Creates the initial ui plugin state.
 *
 * @param _ctx - Minimal context providing the global registry and resolved config.
 * @param _ctx.global - Global plugin registry (unused; required by the kernel).
 * @param _ctx.config - Resolved ui configuration (unused at creation; defaults apply in builders).
 * @returns The initial ui state: no root, empty stack + HUD, zeroed edge counters.
 * @example
 * ```ts
 * const state = createState({ global: {}, config: defaultConfig });
 * state.root;        // undefined
 * state.screens;     // []
 * state.nextId;      // 1
 * ```
 */
export const createState = (_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State => ({
  root: undefined,
  screens: [],
  hud: new Map(),
  hudButtons: [],
  prevButtons: 0,
  armed: undefined,
  nextId: 1
});

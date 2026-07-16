/**
 * @file renderer plugin — state factory.
 *
 * Creates the initial mutable renderer state. The Pixi Application is absent
 * until onStart completes and is stored here (and in the teardown WeakMap).
 */
import type { Config, State } from "./types";

/**
 * Creates the initial renderer plugin state.
 *
 * @param _ctx - Minimal context providing global registry and resolved config.
 * @param _ctx.global - Global plugin registry (unused; required by the kernel).
 * @param _ctx.config - Resolved renderer configuration.
 * @returns The initial renderer state with no Application and empty collections.
 * @example
 * ```ts
 * const state = createState({ global: {}, config: defaultConfig });
 * state.app;       // undefined
 * state.views;     // Map {}
 * state.dirty;     // Set {}
 * state.textureResolver; // undefined — the flat-app default
 * ```
 */
export const createState = (_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State => ({
  app: undefined,
  transformToken: undefined,
  views: new Map(),
  dirty: new Set(),
  textureResolver: undefined,
  worldResolver: undefined,
  grid: undefined
});

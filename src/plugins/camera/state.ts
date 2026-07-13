/**
 * @file camera plugin — state factory.
 *
 * Creates the initial mutable camera state: no captured stage/tween yet, an empty
 * layer registry, a centre at the origin, no follow target, zoom 1, no rotation, no
 * shake, and `started: false` (the API creators no-op until onStart captures the
 * deps and flips this flag). `zoom` is re-seeded from `config.zoom` in onStart.
 */
import type { Config, State } from "./types";

/**
 * Creates the initial camera plugin state.
 *
 * @param _ctx - Minimal context providing global registry and resolved config.
 * @param _ctx.global - Global plugin registry (unused; required by the kernel).
 * @param _ctx.config - Resolved camera configuration (unused at creation; `zoom` is seeded in onStart).
 * @returns The initial camera state (no stage/tween, empty layers, centre at origin, `started: false`).
 * @example
 * ```ts
 * const state = createState({ global: {}, config: defaultConfig });
 * state.started; // false
 * state.center; // { x: 0, y: 0 }
 * state.layers.size; // 0
 * ```
 */
export const createState = (_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State => ({
  started: false,
  stage: undefined,
  layers: new Map(),
  center: { x: 0, y: 0 },
  follow: undefined,
  zoom: 1,
  rotation: 0,
  shakeIntensity: 0,
  shakeHandle: undefined,
  tween: undefined
});

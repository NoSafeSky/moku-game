/**
 * @file editor-selection plugin — state factory.
 */
import type { Config, State } from "./types";

/**
 * Creates initial editor-selection plugin state: not-started, disabled, an empty selection
 * `Set`, a zeroed pointer-edge mask, and every captured dependency handle `undefined` until
 * `onStart` captures them and `enable()` captures the pick layer / canvas.
 *
 * @param _ctx - Minimal context with global registry + resolved config (unused — state has no config-derived seed).
 * @param _ctx.global - Global plugin registry.
 * @param _ctx.config - Resolved plugin configuration.
 * @returns A fresh {@link State} with an independent `selected` `Set` per plugin instance.
 * @example
 * ```ts
 * const state = createState({ global: {}, config: { pickLayer: "world", multiSelect: false } });
 * ```
 */
export const createState = (_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State => ({
  started: false,
  enabled: false,
  selected: new Set(),
  world: undefined,
  renderer: undefined,
  camera: undefined,
  input: undefined,
  pickLayer: undefined,
  canvas: undefined,
  prevButtons: 0,
  detach: undefined
});

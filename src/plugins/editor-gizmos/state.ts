/**
 * @file editor-gizmos plugin — state factory.
 *
 * Creates the initial mutable editor-gizmos state: not started, disabled, no overlay/
 * handle (built in `onStart` only when a renderer stage exists), mode seeded to
 * `"translate"`, space to `"global"` and pivot to `"pivot"` (all three matching the
 * pre-Phase-1 behaviour), no in-flight drag, no injected gesture sink, and every captured
 * dependency handle `undefined` until `onStart` captures them. `snap` is re-seeded
 * from `config.snap` in `onStart`.
 */
import type { Config, State } from "./types";

/**
 * Creates the initial editor-gizmos plugin state.
 *
 * @param _ctx - Minimal context providing the global registry and resolved config.
 * @param _ctx.global - Global plugin registry (unused; required by the kernel).
 * @param _ctx.config - Resolved editor-gizmos configuration (unused at creation; `snap` is
 *   seeded from it in `onStart`).
 * @returns The initial editor-gizmos state (no overlay/handle/drag, `started: false`,
 *   `mode: "translate"`, `space: "global"`, `pivot: "pivot"`, `snap: 0`).
 * @example
 * ```ts
 * const state = createState({ global: {}, config: defaultConfig });
 * state.started; // false
 * state.mode; // "translate"
 * state.space; // "global"
 * ```
 */
export const createState = (_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State => ({
  started: false,
  enabled: false,
  overlay: undefined,
  handle: undefined,
  mode: "translate",
  space: "global",
  pivot: "pivot",
  snap: 0,
  drag: undefined,
  gestureSink: undefined,
  stage: undefined,
  renderer: undefined,
  camera: undefined,
  selection: undefined,
  commands: undefined
});

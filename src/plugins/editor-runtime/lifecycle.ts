/**
 * @file editor-runtime plugin — onStart lifecycle wiring.
 *
 * `start` runs after all seven dependencies have started (guaranteed by `depends`) and does the
 * MINIMUM deps-ready wiring: it flips `state.started` so the API leaves its before-start guard.
 *
 * It deliberately does **NOT** apply the `editStages` gate at startup. editor-runtime is part of
 * the DEFAULT framework plugin set, so gating here would freeze gameplay (`update`/`physics`) for
 * EVERY app — including non-editor games that never touch the editor. Per the plugin's own
 * pay-for-what-you-use design decision ("a non-editor game pays nothing: `setActiveStages` is
 * never called, `activeStages()` stays `undefined`"), the gate engages ONLY on an explicit
 * `enterEdit()` — which the Layer-3 editor shell calls at boot. `state.mode` stays at its seeded
 * `"edit"` intent; the mechanism (the scheduler gate) is applied when the editor is actually
 * entered, not at startup.
 *
 * `@no-resource-check` — owns no external resource (the loop's rAF is `loop`'s; the active-stages
 * set lives in the ecs world; the pre-play snapshot is plain GC-able state). No `onStop` — see
 * `index.ts`.
 */
import type { State } from "./types";

/**
 * Structural context required by {@link start} — only `state` (onStart just flips `started`).
 */
export type StartContext = {
  /** editor-runtime plugin state (mutated to flip `started`). */
  readonly state: State;
};

/**
 * Starts the editor-runtime plugin: flips `started` so the API's before-start guard opens. Does
 * NOT gate the scheduler — see the file header (pay-for-what-you-use; `enterEdit()` applies the gate).
 *
 * @param ctx - Structural start context (state).
 * @example
 * ```ts
 * start(ctx); // after loop/scheduler/serialization/commands/tween/vfx/camera have started
 * ```
 */
export const start = (ctx: StartContext): void => {
  ctx.state.started = true;
};

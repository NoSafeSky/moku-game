/**
 * @file camera plugin — the editor-control system (Phase-1 F2).
 *
 * Registered ONLY when `config.editorControls` (default off). Each frame it reads the
 * captured `app.input` snapshot and drives two gestures through the shared pure
 * `controls.ts` math: cursor-anchored wheel-zoom and middle-button/space drag-pan. It
 * holds no Pixi/renderer knowledge and is headless-safe — the numeric camera state
 * still updates via `zoomAtScreen` / `panByScreen`, while the container writes remain
 * the apply system's guarded no-ops.
 */
import type { Api as InputApi } from "../input/types";
import type { System } from "../scheduler/types";
import { panByScreen, zoomAtScreen } from "./controls";
import type { Config, Point, State } from "./types";

/**
 * Wheel-to-zoom-factor sensitivity: `factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)`.
 * Scrolling up produces a negative `deltaY` and a `factor > 1` (zoom in); scrolling
 * down produces a positive `deltaY` and a `factor < 1` (zoom out). The exponential
 * form keeps repeated small notches multiplicative (scale-invariant) rather than
 * additive.
 */
const WHEEL_ZOOM_SENSITIVITY = 0.001;

/** Dependencies the editor-control system reads/mutates each frame. */
export type EditorControlDeps = {
  /** camera plugin state (mutated via the shared `controls.ts` math). */
  readonly state: State;
  /** Resolved camera configuration (zoom clamps + reference viewport). */
  readonly config: Readonly<Config>;
  /** The captured `app.input` API, read once per frame via `snapshot()`. */
  readonly input: InputApi;
};

/**
 * Create the editor-control system: cursor-anchored wheel-zoom plus middle-button /
 * space drag-pan, driven by a per-frame `input.snapshot()` read.
 *
 * Keeps one closure-local `lastPointer`, cleared whenever panning is not active so a
 * fresh drag (a new middle-button press, or space held again) starts with no jump.
 *
 * @param deps - camera state, config, and the captured input API.
 * @returns A `System` `(world, dt) => void` for the scheduler `"update"` stage.
 * @example
 * ```ts
 * scheduler.addSystem("update", createEditorControlSystem({ state, config, input }));
 * ```
 */
export const createEditorControlSystem = (deps: EditorControlDeps): System => {
  let lastPointer: Point | undefined;

  return (_world, _dt): void => {
    const { state, config, input } = deps;
    const snap = input.snapshot();

    // (1) Cursor-anchored wheel zoom.
    if (snap.wheel.deltaY !== 0) {
      const factor = Math.exp(-snap.wheel.deltaY * WHEEL_ZOOM_SENSITIVITY);
      zoomAtScreen(state, config, snap.pointer, factor);
    }

    // (2) Middle-button or space drag-pan.
    const panning = (snap.pointer.buttons & 4) !== 0 || snap.isDown(" ");
    if (panning && lastPointer) {
      panByScreen(state, config, snap.pointer.x - lastPointer.x, snap.pointer.y - lastPointer.y);
    }
    // Clear when not panning so the next drag starts fresh (no jump); otherwise track it.
    lastPointer = panning ? { x: snap.pointer.x, y: snap.pointer.y } : undefined;
  };
};

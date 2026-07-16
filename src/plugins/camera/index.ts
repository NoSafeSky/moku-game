/**
 * @file camera plugin (Standard tier) — wiring. See the JSDoc on `cameraPlugin` and `README.md`.
 */
import { createPlugin } from "../../config";
import { inputPlugin } from "../input";
import { rendererPlugin } from "../renderer";
import { schedulerPlugin } from "../scheduler";
import { tweenPlugin } from "../tween";
import { createApi } from "./api";
import { start } from "./lifecycle";
import { createState } from "./state";
import type { Config } from "./types";

const defaultConfig: Config = {
  zoom: 1,
  minZoom: 0.1,
  maxZoom: 10,
  followLerp: 0.15,
  width: 800,
  height: 600,
  updateStage: "sync",
  editorControls: false
};

/**
 * camera plugin — Standard tier.
 *
 * A 2D game camera. It follows a moving target with per-frame exponential smoothing,
 * pans / zooms / rotates instantly or animated over time (the animated forms delegate
 * to `app.tween`, so they are pause-safe for free), applies a decaying screen shake
 * (also `app.tween`-driven), renders parallax by transforming one or more world-space
 * LAYER containers it owns (never the root stage — so the HUD stays screen-fixed), and
 * maps points between screen and world space. A single `"sync"`-stage scheduler system
 * eases the centre toward the follow target, writes each layer's pivot / position /
 * scale / rotation, and adds the shake offset. Emits no events. Headless-safe (numeric
 * state still tracks) and pause-safe. Depends on `renderer` + `scheduler` + `tween` +
 * `input`. No new package dependency (`pixi.js` is already direct via `renderer`).
 *
 * **Phase-1 F2** adds instant editor controls — `focus` / `zoomAt` / `panBy` — plus an
 * opt-in, config-gated (`editorControls`, default `false`) `"update"`-stage system that
 * reads `app.input.snapshot()` each frame to drive cursor-anchored wheel-zoom and
 * middle-button/space drag-pan. The `input` dependency edge stays declared-but-inert
 * for any consumer that leaves `editorControls` at its default.
 *
 * @see README.md
 */
export const cameraPlugin = createPlugin("camera", {
  depends: [rendererPlugin, schedulerPlugin, tweenPlugin, inputPlugin],
  config: defaultConfig,
  createState,
  api: createApi,
  onStart: start // @no-resource-check — captures renderer/scheduler/tween, seeds zoom, builds the world
  //                Container, registers the "sync" apply system (deps-ready wiring; the ui/vfx onStart
  //                pattern), and — only when config.editorControls — captures input and registers the
  //                "update"-stage editor-control system. No onStop: every Container is parented under the
  //                renderer-owned stage — the renderer disposes the subtree; the apply system owns no
  //                external resource; state.tween/state.input are captured references.
});

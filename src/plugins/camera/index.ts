/**
 * @file camera plugin (Standard tier) — wiring. See the JSDoc on `cameraPlugin` and `README.md`.
 */
import { createPlugin } from "../../config";
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
  updateStage: "sync"
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
 * state still tracks) and pause-safe. Depends on `renderer` + `scheduler` + `tween`. No
 * new package dependency (`pixi.js` is already direct via `renderer`).
 *
 * @see README.md
 */
export const cameraPlugin = createPlugin("camera", {
  depends: [rendererPlugin, schedulerPlugin, tweenPlugin],
  config: defaultConfig,
  createState,
  api: createApi,
  onStart: start // @no-resource-check — captures renderer/scheduler/tween, seeds zoom, builds the world
  //                Container, registers the "sync" apply system (deps-ready wiring; the ui/vfx onStart
  //                pattern). No onStop: every Container is parented under the renderer-owned stage — the
  //                renderer disposes the subtree; the apply system owns no external resource; state.tween
  //                is a captured reference.
});

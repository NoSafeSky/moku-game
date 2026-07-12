/**
 * @file ui plugin (Complex tier) — wiring. See the JSDoc on `uiPlugin` and `README.md`.
 */
import { createPlugin } from "../../config";
import { inputPlugin } from "../input";
import { rendererPlugin } from "../renderer";
import { schedulerPlugin } from "../scheduler";
import { createApi } from "./api";
import { start } from "./lifecycle";
import { createState } from "./state";
import type { Config } from "./types";

const defaultConfig: Config = {
  textColor: 0xff_ff_ff,
  fontSize: 20,
  fontFamily: "sans-serif",
  buttonColor: 0x33_55_ff,
  buttonHoverColor: 0x44_66_ff,
  panelColor: 0x14_18_21,
  panelAlpha: 0.92,
  backdropColor: 0x00_00_00,
  backdropAlpha: 0.6,
  padding: 12,
  width: 800,
  height: 600
};

/**
 * ui plugin — Complex tier.
 *
 * PixiJS-native game UI: a screen stack (title / pause / game-over / modal cards), a
 * declarative widget set (label / button / panel / bar), a persistent HUD, and
 * pointer/touch hit-testing via the input plugin. Emits no events (interactions are
 * declarative `onTap` callbacks). Headless-safe. Depends on renderer, scheduler,
 * input. No new package dependencies (Pixi via renderer).
 *
 * @see README.md
 */
export const uiPlugin = createPlugin("ui", {
  depends: [rendererPlugin, schedulerPlugin, inputPlugin],
  config: defaultConfig,
  createState,
  api: createApi,
  onStart: start // @no-resource-check — captures renderer.getStage(), builds the UI root Container,
  //                registers the pointer hit-test system (deps-ready wiring; renderer/vfx onStart pattern).
  //                No onStop: every Pixi node is parented under the renderer-owned stage — the renderer
  //                disposes them; in-run disposal is the API's job; ui state is plain GC-able data.
});

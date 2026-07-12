/**
 * vfx plugin — Complex tier.
 *
 * ECS-native particles (Emitter/Particle entities driven by scheduler systems),
 * trauma-based screen shake, Transform scale-pop, floating damage/score text, and
 * pure easing helpers. Emits no events (per-frame hot path). Headless-safe.
 * Depends on ecs, scheduler, renderer. No new package dependencies (Pixi via
 * renderer).
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { ecsPlugin } from "../ecs";
import { rendererPlugin } from "../renderer";
import { schedulerPlugin } from "../scheduler";
import { createApi } from "./api";
import { start } from "./lifecycle";
import { createState } from "./state";
import type { Config } from "./types";

const defaultConfig: Config = {
  maxParticles: 1000,
  shakeDecay: 1.8,
  shakeMaxOffset: 24,
  defaultColor: 0xff_ff_ff
};

export const vfxPlugin = createPlugin("vfx", {
  depends: [ecsPlugin, schedulerPlugin, rendererPlugin],
  config: defaultConfig,
  createState,
  api: createApi,
  onStart: start // @no-resource-check — deps-ready wiring: captures renderer.Transform,
  //                defines the 4 vfx components, registers the 5 effect systems (the
  //                renderer.onStart pattern). No onStop: every effect view is
  //                renderer-owned (attach/attachPrimitive), so the renderer disposes it.
});

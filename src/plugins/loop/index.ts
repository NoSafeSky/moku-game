/**
 * Loop plugin — Standard tier.
 *
 * Owns the rAF fixed-timestep frame (kernel-bypassing hot path): drives
 * scheduler.tick(dt) then renderer.render(). rAF handle in a ctx.global WeakMap. Emits no events.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { rendererPlugin } from "../renderer";
import { schedulerPlugin } from "../scheduler";
import { createApi } from "./api";
import { start, stop } from "./lifecycle";
import { createState } from "./state";
import type { Config } from "./types";

const defaultConfig: Config = {
  fixedDt: 1 / 60,
  maxFrameDelta: 0.25,
  maxStepsPerFrame: 5,
  autoStart: true
};

export const loopPlugin = createPlugin("loop", {
  depends: [schedulerPlugin, rendererPlugin],
  config: defaultConfig,
  createState,
  api: createApi,
  onStart: start, // @no-resource-check — schedules the requestAnimationFrame loop (spec/06 §3)
  onStop: stop // @no-resource-check — cancels rAF via the ctx.global WeakMap (spec/06 §4)
});

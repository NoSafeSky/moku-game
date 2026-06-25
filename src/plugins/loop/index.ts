/**
 * Loop plugin — Standard tier.
 *
 * Owns the rAF fixed-timestep frame (kernel-bypassing hot path): drives
 * scheduler.tick(dt) then renderer.render(). rAF handle in a ctx.global WeakMap. Emits no events.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { ecsPlugin } from "../ecs";
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

/**
 * Loop plugin — drives the fixed-timestep game loop via rAF.
 *
 * Depends on `schedulerPlugin`, `rendererPlugin`, and `ecsPlugin`.
 * On start, binds the `Time` resource onto the ECS world so any system can
 * read the current `dt`, `elapsed`, and `frame` via `world.resource(app.loop.time)`.
 */
export const loopPlugin = createPlugin("loop", {
  depends: [schedulerPlugin, rendererPlugin, ecsPlugin],
  config: defaultConfig,
  createState,
  api: createApi,
  onStart: start, // @no-resource-check — schedules the requestAnimationFrame loop + binds the Time resource (spec/06 §3)
  onStop: stop // @no-resource-check — cancels rAF via the ctx.global WeakMap (spec/06 §4)
});

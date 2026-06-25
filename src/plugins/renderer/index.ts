/**
 * Renderer plugin — Complex tier.
 *
 * Isolates PixiJS v8 rendering; owns the GPU Application (onStart/onStop via a
 * ctx.global WeakMap) and the sync stage system. Emits no events.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { ecsPlugin } from "../ecs";
import { schedulerPlugin } from "../scheduler";
import { createApi } from "./api";
import { detectHeadless, start, stop } from "./lifecycle";
import { createState } from "./state";
import type { Config } from "./types";

const defaultConfig: Config = {
  width: 800,
  height: 600,
  background: 0x00_00_00,
  resolution: 0,
  antialias: true,
  mount: undefined,
  headless: detectHeadless()
};

export const rendererPlugin = createPlugin("renderer", {
  depends: [ecsPlugin, schedulerPlugin],
  config: defaultConfig,
  createState,
  api: createApi,
  onStart: start, // @no-resource-check — manages the Pixi GPU Application (spec/06 §3)
  onStop: stop // @no-resource-check — disposes GPU resources via the ctx.global WeakMap (spec/06 §4)
});

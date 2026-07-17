/**
 * @file graphics-2d plugin (Standard tier) — wiring. See the JSDoc on `graphics2dPlugin` and
 * `README.md`.
 */
import { createPlugin } from "../../config";
import { assetsPlugin } from "../assets";
import { componentRegistryPlugin } from "../component-registry";
import { ecsPlugin } from "../ecs";
import { reflectionPlugin } from "../reflection";
import { rendererPlugin } from "../renderer";
import { createApi } from "./api";
import { start } from "./lifecycle";
import { createState } from "./state";
import type { Config } from "./types";

const defaultConfig: Config = {};

/**
 * graphics-2d plugin — Standard tier.
 *
 * The Phase-1 render-component library: defines the SpriteRenderer + Shape components, registers
 * their reflection schemas + component-registry catalog entries, runs a changeEpoch-gated sync-stage
 * system that reconciles those components into Pixi views via the renderer's public API, and injects
 * an assets→renderer texture resolver. "The component IS the renderable." No pixi.js import; no
 * onStop (views are renderer-owned scene data); emits no events.
 *
 * @see README.md
 */
export const graphics2dPlugin = createPlugin("graphics-2d", {
  depends: [ecsPlugin, rendererPlugin, reflectionPlugin, componentRegistryPlugin, assetsPlugin],
  config: defaultConfig,
  createState,
  api: createApi,
  onStart: start // @no-resource-check — deps-ready wiring only (define components, register schemas +
  //                catalog entries, register the sync system via world.addSystem, inject the texture
  //                resolver). No onStop: views are renderer-owned scene data, and every other artifact
  //                lives on a dependency-owned structure discarded with the app.
});

export type { ShapeValue, SpriteRendererValue } from "./types";

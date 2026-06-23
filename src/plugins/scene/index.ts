/**
 * Scene plugin — Standard tier.
 *
 * Named scene load/unload with entity ownership tracking. Emits `scene:loaded`.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { assetsPlugin } from "../assets";
import { ecsPlugin } from "../ecs";
import { rendererPlugin } from "../renderer";
import { createApi } from "./api";
import { createState } from "./state";
import type { Config, Events } from "./types";

const defaultConfig: Config = { initial: undefined, despawnOnUnload: true };

export const scenePlugin = createPlugin("scene", {
  depends: [ecsPlugin, rendererPlugin, assetsPlugin],
  config: defaultConfig,
  /**
   * Declares this plugin's events so they are typed on `ctx.emit`.
   *
   * @param register - The framework event registrar.
   * @returns The registered event descriptor map.
   * @example
   * ```ts
   * events: (register) => register.map<Events>({ "scene:loaded": "…" });
   * ```
   */
  events: register =>
    register.map<Events>({
      "scene:loaded": "Fired after a scene's setup completes"
    }),
  createState,
  /**
   * Builds the plugin API, forwarding the plugin context so declared events infer on `ctx.emit`.
   *
   * @param ctx - The plugin context.
   * @returns The plugin API surface.
   * @example
   * ```ts
   * api: (ctx) => createApi(ctx);
   * ```
   */
  api: ctx => createApi(ctx) // inline lambda so declared events infer into ctx.emit
});

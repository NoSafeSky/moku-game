/**
 * Assets plugin — Standard tier.
 *
 * Pixi v8 Assets loading + caching. Emits `assets:loaded`.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { rendererPlugin } from "../renderer";
import { createApi } from "./api";
import { createState } from "./state";
import type { Config, Events } from "./types";

const defaultConfig: Config = { basePath: "", manifest: {}, throwOnError: true };

export const assetsPlugin = createPlugin("assets", {
  depends: [rendererPlugin],
  config: defaultConfig,
  /**
   * Declares this plugin's events so they are typed on `ctx.emit`.
   *
   * @param register - The framework event registrar.
   * @returns The registered event descriptor map.
   * @example
   * ```ts
   * events: (register) => register.map<Events>({ "assets:loaded": "…" });
   * ```
   */
  events: register =>
    register.map<Events>({
      "assets:loaded": "Fired when an asset or bundle finishes loading"
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

/**
 * Standard tier — viewport picking (Pixi eventMode pick-layer) + selection model.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { cameraPlugin } from "../camera";
import { ecsPlugin } from "../ecs";
import { inputPlugin } from "../input";
import { rendererPlugin } from "../renderer";
import { createApi } from "./api";
import { start } from "./lifecycle";
import { createState } from "./state";
import type { Config, Events } from "./types";

const defaultConfig: Config = { pickLayer: "world", multiSelect: false };

export const editorSelectionPlugin = createPlugin("editor-selection", {
  depends: [ecsPlugin, rendererPlugin, cameraPlugin, inputPlugin],
  config: defaultConfig,
  /**
   * Declares this plugin's events so they are typed on `ctx.emit`.
   *
   * @param register - The framework event registrar.
   * @returns The registered event descriptor map.
   * @example
   * ```ts
   * events: (register) => register.map<Events>({ "editor-selection:changed": "…" });
   * ```
   */
  events: register =>
    register.map<Events>({
      "editor-selection:changed":
        "Fired when the selection set changes (coarse, user-gesture frequency)"
    }),
  createState,
  /**
   * Builds the plugin API, forwarding the context so declared events infer on `ctx.emit`.
   *
   * @param ctx - The plugin context.
   * @returns The plugin API surface.
   * @example
   * ```ts
   * api: (ctx) => createApi(ctx);
   * ```
   */
  api: ctx => createApi(ctx),
  // @no-resource-check — captures ecs/renderer/camera/input APIs; leaves the plugin DISABLED until
  // the editor host calls enable(). No onStop: the pick layer is a renderer-owned Container.
  onStart: start
});

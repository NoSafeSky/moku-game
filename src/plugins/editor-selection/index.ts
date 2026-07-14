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

/**
 * editor-selection plugin — Standard tier.
 *
 * Viewport picking + selection model for the editor. `enable()`/`disable()` flip Pixi
 * interactivity on ONE camera pick layer (zero cost outside edit mode); `pickAt(screen)`
 * resolves the topmost entity via a non-enumerable `entity` handle stamped on each view
 * (the ecs `__id` pattern); `select`/`toggle`/`clear` drive a `Set<Entity>` and emit the
 * coarse `editor-selection:changed`. Headless-safe. Depends on ecs, renderer, camera,
 * input. No new package dependencies (Pixi via renderer). MVP: single-select click.
 *
 * @see README.md
 */
export const editorSelectionPlugin = createPlugin("editor-selection", {
  depends: [ecsPlugin, rendererPlugin, cameraPlugin, inputPlugin],
  config: defaultConfig,
  /**
   * Declares this plugin's events so `editor-selection:changed` is typed on `ctx.emit`.
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
   * Builds the plugin API, forwarding the plugin context so the declared event infers
   * on `ctx.emit`.
   *
   * @param ctx - The plugin context.
   * @returns The plugin API surface.
   * @example
   * ```ts
   * api: (ctx) => createApi(ctx);
   * ```
   */
  api: ctx => createApi(ctx), // inline lambda so the declared event infers into ctx.emit
  onStart: start // @no-resource-check — captures ecs/renderer/camera/input APIs; leaves the plugin DISABLED
  //               (interactivity off until the editor host calls enable()). No onStop: the pick layer is a
  //               renderer-owned Container (renderer disposes it), the listener is removed by disable(), and
  //               the captured handles / selection Set are plain references / GC-able data.
});

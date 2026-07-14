/**
 * Complex tier — edit/play stage-gating FSM; snapshot/restore + tween/vfx/camera reset() on stop.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { cameraPlugin } from "../camera";
import { commandsPlugin } from "../commands";
import { loopPlugin } from "../loop";
import { schedulerPlugin } from "../scheduler";
import { serializationPlugin } from "../serialization";
import { tweenPlugin } from "../tween";
import { vfxPlugin } from "../vfx";
import { createApi } from "./api";
import { start } from "./lifecycle";
import { createState } from "./state";
import type { Config, Events } from "./types";

const defaultConfig: Config = { editStages: ["input", "sync", "render"] };

export const editorRuntimePlugin = createPlugin("editor-runtime", {
  depends: [
    loopPlugin,
    schedulerPlugin,
    serializationPlugin,
    commandsPlugin,
    tweenPlugin,
    vfxPlugin,
    cameraPlugin
  ],
  config: defaultConfig,
  /**
   * Declares this plugin's events so they are typed on `ctx.emit`.
   *
   * @param register - The framework event registrar.
   * @returns The registered event descriptor map.
   * @example
   * ```ts
   * events: (register) => register.map<Events>({ "editor-runtime:modeChanged": "…" });
   * ```
   */
  events: register =>
    register.map<Events>({
      "editor-runtime:modeChanged": "Fired after an edit↔play mode flip"
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
  onStart: start // @no-resource-check — deps-ready wiring: applies the initial edit-mode gate
});

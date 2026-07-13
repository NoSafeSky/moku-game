/**
 * Standard tier — the single validated write-authority for editor ECS mutation (owns EditorId).
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { ecsPlugin } from "../ecs";
import { createApi } from "./api";
import { createState } from "./state";
import type { Events } from "./types";

export const commandsPlugin = createPlugin("commands", {
  depends: [ecsPlugin],
  config: { maxIdWarn: 100_000 },
  /**
   * Declares this plugin's events so they are typed on `ctx.emit`.
   *
   * @param register - The framework event registrar.
   * @returns The registered event descriptor map.
   * @example
   * ```ts
   * events: (register) => register.map<Events>({ "commands:restored": "…" });
   * ```
   */
  events: register =>
    register.map<Events>({
      "commands:restored": "Fired after a non-undoable restore() reseeds the world + EditorId map"
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
  api: ctx => createApi(ctx)
});

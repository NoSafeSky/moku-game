/**
 * Complex tier — versioned SceneDocument (de)serializer; save/load via storage; export/import.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { commandsPlugin } from "../commands";
import { ecsPlugin } from "../ecs";
import { reflectionPlugin } from "../reflection";
import { storagePlugin } from "../storage";
import { createApi } from "./api";
import { createState } from "./state";
import type { Config, Events } from "./types";

const defaultConfig: Config = { storageKeyPrefix: "scene:", version: 1, migrations: {} };

export const serializationPlugin = createPlugin("serialization", {
  depends: [ecsPlugin, storagePlugin, commandsPlugin, reflectionPlugin],
  config: defaultConfig,
  /**
   * Declares this plugin's events so they are typed on `ctx.emit`.
   *
   * @param register - The framework event registrar.
   * @returns The registered event descriptor map.
   * @example
   * ```ts
   * events: (register) => register.map<Events>({ "serialization:loaded": "…" });
   * ```
   */
  events: register =>
    register.map<Events>({
      "serialization:loaded": "Fired after a SceneDocument is deserialized into the world"
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

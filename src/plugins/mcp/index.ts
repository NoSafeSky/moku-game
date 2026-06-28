/**
 * MCP plugin — Complex tier.
 *
 * First-class MCP server exposing the whole runtime to agent clients over stdio +
 * Streamable HTTP. Mutations route through the ECS command buffer.
 * Emits `game:reset` after a hard reset despawns MCP-tracked entities and unloads
 * the scene.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { assetsPlugin } from "../assets";
import { ecsPlugin } from "../ecs";
import { inputPlugin } from "../input";
import { loopPlugin } from "../loop";
import { rendererPlugin } from "../renderer";
import { scenePlugin } from "../scene";
import { schedulerPlugin } from "../scheduler";
import { createApi } from "./api";
import { start, stop } from "./lifecycle";
import { createState } from "./state";
import { defaultTransports } from "./transport";
import type { Config, Events } from "./types";

const defaultConfig: Config = {
  transports: defaultTransports(),
  httpHost: "127.0.0.1",
  httpPort: 3333,
  httpAuth: "none",
  bearerToken: "",
  enableMutations: true,
  inMemoryGlobalKey: "__MOKU_GAME_MCP__"
};

/**
 * MCP plugin instance — Complex tier.
 *
 * Exposes the full game runtime (ECS world, renderer, scene, loop, input) to MCP
 * agent clients via stdio / Streamable HTTP / in-page inMemory transports.
 * Mutating tools are frame-safe (command-buffered). Emits `game:reset` on hard reset.
 *
 * @see README.md
 */
export const mcpPlugin = createPlugin("mcp", {
  depends: [
    ecsPlugin,
    schedulerPlugin,
    rendererPlugin,
    // assetsPlugin is a hard dep by design (decisions.md): mcp ships as a framework default
    // alongside all seven and registers/tears down LAST. No tool requires assets yet (reserved
    // for v2 asset tools), so it has no ctx.require() call — retained for the whole-runtime
    // contract + registration-order guarantee. inputPlugin IS now required (Cycle 4 input:key).
    assetsPlugin,
    inputPlugin,
    loopPlugin,
    scenePlugin
  ],
  config: defaultConfig,
  createState,
  api: createApi,
  /**
   * Registers the mcp plugin's typed event map.
   *
   * @param register - The event registration helper from createPlugin.
   * @returns The typed event map for this plugin.
   * @example
   * ```ts
   * events: register => register.map<Events>({ "game:reset": "…" })
   * ```
   */
  events: register =>
    register.map<Events>({
      "game:reset": "Emitted after game:reset despawns tracked entities + unloads the scene"
    }),
  /**
   * Starts the MCP server: validates config, wires systems, registers tools and
   * resources, connects transports. Inline lambda so declared events infer into
   * ctx.emit (mirrors scene plugin pattern).
   *
   * @param ctx - Plugin execution context providing config, state, global, log, emit, and require.
   * @returns A Promise that resolves once the server is connected.
   * @example
   * ```ts
   * // Called automatically by the framework during app.start()
   * ```
   */
  onStart: ctx => start(ctx), // @no-resource-check — connects the MCP server transports (spec/06 §3)
  onStop: stop // @no-resource-check — closes the server via the ctx.global WeakMap (spec/06 §4)
});

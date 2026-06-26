/**
 * MCP plugin — Complex tier.
 *
 * First-class MCP server exposing the whole runtime to agent clients over stdio +
 * Streamable HTTP. Mutations route through the ECS command buffer. Emits no events.
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
import type { Config } from "./types";

const defaultConfig: Config = {
  transports: defaultTransports(),
  httpHost: "127.0.0.1",
  httpPort: 3333,
  httpAuth: "none",
  bearerToken: "",
  enableMutations: true,
  inMemoryGlobalKey: "__MOKU_GAME_MCP__"
};

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
  onStart: start, // @no-resource-check — connects the MCP server transports (spec/06 §3)
  onStop: stop // @no-resource-check — closes the server via the ctx.global WeakMap (spec/06 §4)
});

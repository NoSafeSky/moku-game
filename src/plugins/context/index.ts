/**
 * Context plugin — Standard tier.
 *
 * Binds the framework well-known resources (Assets, GameContext) onto the ECS world
 * at start, so any system reaches them via `world.resource(token)`. Emits no events.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { assetsPlugin } from "../assets";
import { ecsPlugin } from "../ecs";
import { createApi } from "./api";
import { start } from "./lifecycle";
import { createState } from "./state";
import type { Config } from "./types";

const defaultConfig: Config = { bindGameContext: true };

export const contextPlugin = createPlugin("context", {
  depends: [ecsPlugin, assetsPlugin],
  config: defaultConfig,
  createState,
  api: createApi,
  onStart: start // @no-resource-check — binds Assets + GameContext resources onto the ECS world at start (spec/15 §2.5)
});

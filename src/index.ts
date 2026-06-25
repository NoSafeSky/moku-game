/**
 * @file game — ECS game framework on PixiJS v8, composable with `@moku-labs/web`,
 * with a first-class MCP plugin exposing the live runtime to agent clients.
 */
import { coreConfig, createCore } from "./config";
import {
  assetsPlugin,
  contextPlugin,
  ecsPlugin,
  inputPlugin,
  loopPlugin,
  mcpPlugin,
  rendererPlugin,
  scenePlugin,
  schedulerPlugin
} from "./plugins";

const framework = createCore(coreConfig, {
  plugins: [
    ecsPlugin,
    schedulerPlugin,
    rendererPlugin,
    inputPlugin,
    loopPlugin,
    assetsPlugin,
    contextPlugin,
    scenePlugin,
    mcpPlugin
  ],
  // Framework default plugin configuration. Consumers override via createApp({ pluginConfigs }).
  pluginConfigs: {
    /** context plugin: bind the curated GameContext resource at start (Assets always bound). */
    context: { bindGameContext: true }
  }
});

// ─── Plugins + Types ──────────────────────────────────────────
export * from "./plugins";

// ─── Framework API + Plugin Helpers ──────────────────────────
/**
 * Create a game application. Returns the App synchronously; call `await app.start()` to begin.
 *
 * @param options - Consumer plugins, config overrides, and per-plugin `pluginConfigs`.
 * @returns A typed App exposing every plugin's API (app.ecs, app.scheduler, …).
 */
export const createApp = framework.createApp;

/**
 * Define a consumer plugin for this game framework. Types infer from the spec object.
 *
 * @param name - Unique plugin id.
 * @param spec - Plugin spec (config, createState, api, depends, events, hooks, lifecycle).
 * @returns A typed plugin definition.
 */
export const createPlugin = framework.createPlugin;

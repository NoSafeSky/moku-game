/**
 * @file game — ECS game framework on PixiJS v8, composable with `@moku-labs/web`,
 * with a first-class MCP plugin exposing the live runtime to agent clients.
 */
import { coreConfig, createCore } from "./config";
import {
  assetsPlugin,
  audioPlugin,
  cameraPlugin,
  commandsPlugin,
  contextPlugin,
  ecsPlugin,
  editorGizmosPlugin,
  editorHistoryPlugin,
  editorRuntimePlugin,
  editorSelectionPlugin,
  inputPlugin,
  loopPlugin,
  mcpPlugin,
  platformPlugin,
  reflectionPlugin,
  rendererPlugin,
  scenePlugin,
  schedulerPlugin,
  serializationPlugin,
  storagePlugin,
  tweenPlugin,
  uiPlugin,
  vfxPlugin
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
    audioPlugin,
    storagePlugin,
    platformPlugin,
    vfxPlugin,
    uiPlugin,
    tweenPlugin,
    cameraPlugin,
    mcpPlugin,
    // ─── Editor subsystem (Layer-2) — registered after mcp; commands/reflection are the
    //     E1 foundations (write-authority + field-schema registry); serialization +
    //     editor-selection are E2 (scene persistence + viewport picking); editor-history +
    //     editor-gizmos + editor-runtime are E3 (undo/redo, transform gizmo, edit/play FSM).
    //     editor-bridge (E4) depends on mcp + all editor plugins and becomes the last entry.
    commandsPlugin,
    reflectionPlugin,
    serializationPlugin,
    editorSelectionPlugin,
    editorHistoryPlugin,
    editorGizmosPlugin,
    editorRuntimePlugin
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

// ─── Advanced / Headless Core Assembly ───────────────────────
// Layer-1/2 escape hatches for composing a custom (e.g. headless) core. `createApp` above
// remains the default entry point; these are documented at their source in `./config`.
export { createCore, createCoreConfig } from "./config";
// ─── Plugin Helpers ──────────────────────────────────────────
// The `field.*` builder set (reflection) for authoring typed component schemas at module scope.
export { field } from "./plugins/reflection";

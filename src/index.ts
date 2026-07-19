/**
 * @file game — ECS game framework on PixiJS v8, composable with `@moku-labs/web`,
 * with a first-class MCP plugin exposing the live runtime to agent clients.
 */
import { coreConfig, createCore } from "./config";
import {
  assetStorePlugin,
  assetsPlugin,
  audioPlugin,
  cameraPlugin,
  commandsPlugin,
  componentRegistryPlugin,
  contextPlugin,
  ecsPlugin,
  editorBridgePlugin,
  editorGizmosPlugin,
  editorHistoryPlugin,
  editorRuntimePlugin,
  editorSelectionPlugin,
  graphics2dPlugin,
  hierarchyPlugin,
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
    // asset-store: foundational (no deps) — MUST precede graphics-2d, which depends on it
    assetStorePlugin,
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
    //     editor-gizmos + editor-runtime are E3 (undo/redo, transform gizmo, edit/play FSM);
    //     editor-bridge (E4) is the terminal facade — depends on mcp + all editor plugins and is
    //     registered LAST (all nine editor edges point backwards, so this is topologically valid).
    commandsPlugin,
    reflectionPlugin,
    // hierarchy owns the scene-graph Node component + the sync-stage world-transform system, so it
    // must follow ALL FOUR of its real deps — ecs/renderer (above) and commands/reflection (just
    // registered). A literal "after renderer" placement would splice it before commands/reflection
    // and break its onStart ctx.require calls. component-registry is a dependency-free catalog
    // (empty depends), so its position is arbitrary; it sits beside hierarchy for cohesion and
    // ahead of graphics-2d (F3), which registers its addable components into it at onStart.
    componentRegistryPlugin,
    hierarchyPlugin,
    // sync-stage order: register after hierarchyPlugin — see .planning/specs/27-graphics-2d.md
    // "Ordering note". graphics-2d has NO depends edge on hierarchy (that would be a dead edge), so
    // this ordering is a tidiness convention, not a correctness requirement: both plugins' sync
    // systems only mark entities dirty, and the renderer pulls the CURRENT local transforms through
    // hierarchy's injected world-transform resolver at position-time. Keep the order anyway so a
    // future reorder is a conscious choice rather than a silent regression.
    graphics2dPlugin,
    serializationPlugin,
    editorSelectionPlugin,
    editorHistoryPlugin,
    editorGizmosPlugin,
    editorRuntimePlugin,
    editorBridgePlugin
  ],
  // Framework default plugin configuration. Consumers override via createApp({ pluginConfigs }).
  pluginConfigs: {
    /** context plugin: bind the curated GameContext resource at start (Assets always bound). */
    context: { bindGameContext: true },
    /** asset-store plugin: IndexedDB database/store names + accepted MIME-type prefixes for import. */
    "asset-store": { dbName: "moku-assets", storeName: "assets", accept: ["image/"] }
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

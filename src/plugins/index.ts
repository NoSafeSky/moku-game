// biome-ignore-all assist/source/organizeImports: two-section barrel (plugin instances, then type namespaces) per skeleton-spec Barrel Pattern
/**
 * Plugin barrel — re-exports all framework plugin instances and types.
 * Helpers are NOT exported here — see src/index.ts.
 */

// ─── Plugin Instances ────────────────────────────────────────
export { assetsPlugin } from "./assets";
export { audioPlugin } from "./audio";
export { cameraPlugin } from "./camera";
export { commandsPlugin } from "./commands";
export { componentRegistryPlugin } from "./component-registry";
export { contextPlugin } from "./context";
export { ecsPlugin } from "./ecs";
export { editorBridgePlugin } from "./editor-bridge";
export { editorGizmosPlugin } from "./editor-gizmos";
export { editorHistoryPlugin } from "./editor-history";
export { editorRuntimePlugin } from "./editor-runtime";
export { editorSelectionPlugin } from "./editor-selection";
export { graphics2dPlugin } from "./graphics-2d";
export { hierarchyPlugin } from "./hierarchy";
export { inputPlugin } from "./input";
export { loopPlugin } from "./loop";
export { mcpPlugin } from "./mcp";
export { platformPlugin } from "./platform";
export { reflectionPlugin } from "./reflection";
export { rendererPlugin } from "./renderer";
export { scenePlugin } from "./scene";
export { schedulerPlugin } from "./scheduler";
export { serializationPlugin } from "./serialization";
export { storagePlugin } from "./storage";
export { tweenPlugin } from "./tween";
export { uiPlugin } from "./ui";
export { vfxPlugin } from "./vfx";

// ─── Plugin Types (namespace re-exports) ─────────────────────
export * as Assets from "./assets/types";
export * as Audio from "./audio/types";
export * as Camera from "./camera/types";
export * as Commands from "./commands/types";
export * as ComponentRegistry from "./component-registry/types";
export * as Context from "./context/types";
export * as Ecs from "./ecs/types";
export * as EditorBridge from "./editor-bridge/types";
export * as EditorGizmos from "./editor-gizmos/types";
export * as EditorHistory from "./editor-history/types";
export * as EditorRuntime from "./editor-runtime/types";
export * as EditorSelection from "./editor-selection/types";
export * as Graphics2d from "./graphics-2d/types";
export * as Hierarchy from "./hierarchy/types";
export * as Input from "./input/types";
export * as Loop from "./loop/types";
export * as Mcp from "./mcp/types";
export * as Platform from "./platform/types";
export * as Reflection from "./reflection/types";
export * as Renderer from "./renderer/types";
export * as Scene from "./scene/types";
export * as Scheduler from "./scheduler/types";
export * as Serialization from "./serialization/types";
export * as Storage from "./storage/types";
export * as Tween from "./tween/types";
export * as Ui from "./ui/types";
export * as Vfx from "./vfx/types";

// biome-ignore-all assist/source/organizeImports: two-section barrel (plugin instances, then type namespaces) per skeleton-spec Barrel Pattern
/**
 * Plugin barrel — re-exports all framework plugin instances and types.
 * Helpers are NOT exported here — see src/index.ts.
 */

// ─── Plugin Instances ────────────────────────────────────────
export { assetsPlugin } from "./assets";
export { audioPlugin } from "./audio";
export { contextPlugin } from "./context";
export { ecsPlugin } from "./ecs";
export { inputPlugin } from "./input";
export { loopPlugin } from "./loop";
export { mcpPlugin } from "./mcp";
export { platformPlugin } from "./platform";
export { rendererPlugin } from "./renderer";
export { scenePlugin } from "./scene";
export { schedulerPlugin } from "./scheduler";
export { storagePlugin } from "./storage";
export { vfxPlugin } from "./vfx";

// ─── Plugin Types (namespace re-exports) ─────────────────────
export * as Assets from "./assets/types";
export * as Audio from "./audio/types";
export * as Context from "./context/types";
export * as Ecs from "./ecs/types";
export * as Input from "./input/types";
export * as Loop from "./loop/types";
export * as Mcp from "./mcp/types";
export * as Platform from "./platform/types";
export * as Renderer from "./renderer/types";
export * as Scene from "./scene/types";
export * as Scheduler from "./scheduler/types";
export * as Storage from "./storage/types";
export * as Vfx from "./vfx/types";

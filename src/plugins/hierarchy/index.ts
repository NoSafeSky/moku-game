/**
 * @file hierarchy plugin (Complex tier) — wiring. See the JSDoc on `hierarchyPlugin` and `README.md`.
 */
import { createPlugin } from "../../config";
import { commandsPlugin } from "../commands";
import { ecsPlugin } from "../ecs";
import { reflectionPlugin } from "../reflection";
import { rendererPlugin } from "../renderer";
import { createApi } from "./api";
import { start } from "./lifecycle";
import { createState } from "./state";
import type { Config } from "./types";

const defaultConfig: Config = { maxDepth: 64 };

/**
 * hierarchy plugin — Complex tier.
 *
 * Owns the scene-graph Node component (`{ parent, order, name, enabled }`) and the sync-stage
 * world-transform system (worldOf composes local Transform up the parent chain, root-healing an
 * unresolvable parent at read time). At onStart it self-registers the Node reflection schema and
 * injects `renderer.setWorldTransformResolver` so the renderer positions views in world space.
 * Hierarchy is an ordinary component, so serialization is unchanged and reparent is a setField
 * burst (composed by editor-bridge), not a new Command kind. Emits no events.
 *
 * @see README.md
 */
export const hierarchyPlugin = createPlugin("hierarchy", {
  depends: [ecsPlugin, rendererPlugin, commandsPlugin, reflectionPlugin],
  config: defaultConfig,
  createState,
  api: createApi,
  onStart: start // @no-resource-check — defines the Node token, self-registers the Node reflection
  //                schema, registers the world-transform sync system, and injects the renderer
  //                world-transform resolver (deps-ready wiring; no owned external resource). No
  //                onStop: the Node token + system live on ecs/renderer-owned structures.
});

export type { NodeValue } from "./types";

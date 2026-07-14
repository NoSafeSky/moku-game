import { createPlugin } from "../../config";
import { commandsPlugin } from "../commands";
import { ecsPlugin } from "../ecs";
import { editorGizmosPlugin } from "../editor-gizmos";
import { editorHistoryPlugin } from "../editor-history";
import { editorRuntimePlugin } from "../editor-runtime";
import { editorSelectionPlugin } from "../editor-selection";
import { mcpPlugin } from "../mcp";
import { reflectionPlugin } from "../reflection";
import { serializationPlugin } from "../serialization";
import { createApi } from "./api";
import { start } from "./lifecycle";
import { createState } from "./state";

/**
 * editor-bridge plugin — Complex tier.
 *
 * Typed facade for the (deferred) Layer-3 `@moku-labs/web` editor app — the single `Api` the web
 * shell consumes (`gameApp["editor-bridge"]`), never `createCore`/`createCoreConfig`. Aggregates a
 * poll-on-epoch immutable `snapshot()` from ecs + reflection + selection + runtime + history, and
 * forwards every write to the single write-authority (`setField`/`apply` → `editor-history.applyTracked`
 * → `commands.applyRaw`). Wires `commands.setValidator(reflection.validate)` and the `editor-gizmos`
 * gesture sink at `onStart`. Emits nothing; listens to nothing (pull-facade — poll-on-epoch, spec/01
 * §2 kernel-bypass). Registered LAST in the `createCore` array (all nine edges point backwards).
 *
 * @see README.md
 */
export const editorBridgePlugin = createPlugin("editor-bridge", {
  depends: [
    ecsPlugin,
    reflectionPlugin,
    commandsPlugin,
    editorSelectionPlugin,
    editorGizmosPlugin,
    editorHistoryPlugin,
    editorRuntimePlugin,
    serializationPlugin,
    mcpPlugin
  ],
  config: {},
  createState,
  api: createApi,
  onStart: start // @no-resource-check — deps-ready wiring: validator + gizmo gesture-sink seams, mcp F1 probe
});

export type { ComponentSnapshot, EditorSnapshot, EntitySnapshot } from "./types";

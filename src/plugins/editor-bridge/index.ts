/**
 * Complex tier — poll-on-epoch facade for the Layer-3 web app; wires setValidator + gizmo gesture sink.
 *
 * @see README.md
 */
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
  onStart: start // @no-resource-check — deps-ready wiring (validator + gizmo sink seams; mcp probe)
});

export type { ComponentSnapshot, EditorSnapshot, EntitySnapshot } from "./types";

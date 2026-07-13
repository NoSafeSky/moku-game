/**
 * Complex tier — translate transform overlay OUTSIDE the ECS; per-tick screenToWorld; gizmo→commands.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { cameraPlugin } from "../camera";
import { commandsPlugin } from "../commands";
import { editorSelectionPlugin } from "../editor-selection";
import { rendererPlugin } from "../renderer";
import { createApi } from "./api";
import { start } from "./lifecycle";
import { createState } from "./state";

export const editorGizmosPlugin = createPlugin("editor-gizmos", {
  depends: [rendererPlugin, cameraPlugin, editorSelectionPlugin, commandsPlugin],
  config: { overlayLayer: "editor-gizmos", snap: 0, translateOnly: true },
  createState,
  api: createApi,
  onStart: start // @no-resource-check — build the overlay on the renderer-owned stage
});

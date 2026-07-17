/**
 * Complex tier — translate/rotate/scale/rect transform overlay OUTSIDE the ECS; per-event
 * screenToWorld; gizmo→commands.
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

/**
 * editor-gizmos plugin — Complex tier.
 *
 * A direct-manipulation transform gizmo overlay OUTSIDE the ECS (editor chrome on a Container
 * parented under the renderer-owned stage, so it never reaches a saved scene). Translate /
 * rotate / scale / rect handles turn a pointer drag on the selected entity into a single,
 * undoable `commands` mutation: the pointer is re-projected via `camera.screenToWorld` on
 * EVERY pointer event (anti-drift — never a cached screen-space delta), the entity's view is
 * previewed live, and the net delta is committed as `setField Transform` command(s) on
 * pointerup ONLY, so an aborted drag leaves the world untouched. The whole drag coalesces into
 * ONE undo entry via the injected `editor-history` gesture sink (`setGestureSink`), falling back
 * to `commands.apply` when no sink is wired — no path skips `commands`. `snap` is one numeric
 * knob, mode-interpreted (world units / scale factor / radians). `space`/`pivot` are toolbar-driven
 * view state, not undoable mutations. `translateOnly` defaults to `true`, so non-editor consumers
 * keep translate-only behaviour and the editor app opts out. Single-target (`selected()[0]`).
 * Emits no events; declares no hooks. Headless-safe. Depends on renderer, camera,
 * editor-selection, commands — `editor-history` is injected, not a dependency edge.
 *
 * @see README.md
 */
export const editorGizmosPlugin = createPlugin("editor-gizmos", {
  depends: [rendererPlugin, cameraPlugin, editorSelectionPlugin, commandsPlugin],
  config: { overlayLayer: "editor-gizmos", snap: 0, translateOnly: true },
  createState,
  api: createApi,
  onStart: start // @no-resource-check — build the overlay on the renderer-owned stage
});

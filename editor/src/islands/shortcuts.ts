/**
 * @file shortcuts island — the editor's global keyboard layer. A container-less-behaviour island that
 * hydrates a document-level `[data-island="shortcuts"]` root and attaches ONE global `keydown` listener,
 * translating each stroke (via `lib/keymap`) into the same bridge / gizmos / camera calls the panels use —
 * shortcuts are a second surface onto existing actions, never a place with unique behaviour (design §4).
 *
 * Ignored while a text field has focus (inline rename, string/number inputs) — the standard typing guard.
 * World state (selection, entity ids, transforms) is read from the polled snapshot; the island renders
 * nothing.
 */
import { createIsland } from "@moku-labs/web/browser";
import type { Commands, EditorBridge } from "@nosafesky/ludemic";
import { getEditor, onSnapshot } from "../lib/editor-host";
import { isTextInputTarget, resolveShortcut } from "../lib/keymap";

// The world point to frame on Focus (F): the primary selection's Transform position, if it has one.
const focusPointOf = (
  snapshot: EditorBridge.EditorSnapshot,
  id: Commands.EditorId
): { x: number; y: number } | undefined => {
  const entity = snapshot.entities.find(candidate => candidate.id === id);
  const transform = entity?.components.find(component => component.name === "Transform");
  const value = transform?.value as { x?: number; y?: number } | undefined;
  if (value && typeof value.x === "number" && typeof value.y === "number") {
    return { x: value.x, y: value.y };
  }
  return undefined;
};

/**
 * Shortcuts island — binds the global editor keymap to the runtime handles.
 *
 * On each `keydown` (outside a text field) it resolves the stroke to an action and dispatches: W/E/R/T →
 * `gizmos.setMode`; F → `camera.focus` (primary selection's position); Ctrl+D → `duplicate`; Del →
 * `delete`; Ctrl+Z/Y → `undo`/`redo`; Ctrl+S → `save`; Ctrl+A → `select` all. The latest snapshot is held
 * from the poll so selection-scoped actions target the current selection. The listener is released on destroy.
 */
export const shortcuts = createIsland("shortcuts", {
  onMount(ctx) {
    let snapshot: EditorBridge.EditorSnapshot | undefined;
    ctx.cleanup(
      onSnapshot(next => {
        snapshot = next;
      })
    );

    const onKeyDown = (event: KeyboardEvent): void => {
      // Never steal keys while the user is typing (inline rename, inspector fields).
      if (isTextInputTarget(event.target)) return;

      const action = resolveShortcut(event);
      if (!action || !snapshot) return;

      const { bridge, gizmos, camera } = getEditor();
      const selection = snapshot.selection;
      event.preventDefault();

      switch (action) {
        case "tool-translate": {
          gizmos.setMode("translate");
          break;
        }
        case "tool-rotate": {
          gizmos.setMode("rotate");
          break;
        }
        case "tool-scale": {
          gizmos.setMode("scale");
          break;
        }
        case "tool-rect": {
          gizmos.setMode("rect");
          break;
        }
        case "focus": {
          const point =
            selection[0] === undefined ? undefined : focusPointOf(snapshot, selection[0]);
          if (point) camera.focus(point);
          break;
        }
        case "duplicate": {
          if (selection.length > 0) bridge.duplicate(...selection);
          break;
        }
        case "delete": {
          if (selection.length > 0) bridge.delete(...selection);
          break;
        }
        case "undo": {
          bridge.undo();
          break;
        }
        case "redo": {
          bridge.redo();
          break;
        }
        case "save": {
          bridge.save("scene");
          break;
        }
        case "select-all": {
          bridge.select(...snapshot.entities.map(entity => entity.id));
          break;
        }
      }
    };

    document.addEventListener("keydown", onKeyDown);
    ctx.cleanup(() => document.removeEventListener("keydown", onKeyDown));
  }
});

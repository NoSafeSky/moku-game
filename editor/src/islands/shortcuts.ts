/**
 * @file shortcuts island — the editor's global keyboard layer, plus the page-wide native-drop safety net.
 * A container-less-behaviour island that hydrates a document-level `[data-island="shortcuts"]` root and
 * attaches ONE global `keydown` listener, translating each stroke (via `lib/keymap`) into the same
 * bridge / gizmos / camera calls the panels use — shortcuts are a second surface onto existing actions,
 * never a place with unique behaviour (design §4).
 *
 * Ignored while a text field has focus (inline rename, string/number inputs) — the standard typing guard.
 * World state (selection, entity ids, transforms) is read from the polled snapshot; the island renders
 * nothing.
 *
 * It also owns the one page-wide `dragover`/`drop` safety net (unrelated to the keymap, but the only other
 * "global, no visible surface" document-level concern the shell has — see {@link onGlobalDragOver}).
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

// The asset-browser → viewport drag (P2) is the ONLY drag that should ever land a "drop" on this app: it
// opts in with the custom ASSET_DND_TYPE and the viewport's own handler calls `preventDefault()` for it.
// Anything else that reaches `dragover`/`drop` — an OS file dragged from Explorer/Finder, a URL or text
// selection dragged from elsewhere in the browser — has NO handler claiming it, so with no global guard
// the browser falls through to its native default: navigating the whole tab to open/display the dropped
// item, which would blow away the entire (in-memory) editor session. A bubbling, unconditional
// `preventDefault()` on both events neutralizes that default everywhere on the page; it never interferes
// with a real asset drop or the hierarchy's reparent drag, since both already call `preventDefault()`
// themselves during the target phase — this document-level catch-all runs after and is a harmless no-op
// there, only doing real work on the drags nothing else claims.
const onGlobalDragOver = (event: DragEvent): void => {
  event.preventDefault();
};
const onGlobalDrop = (event: DragEvent): void => {
  event.preventDefault();
};

/**
 * Shortcuts island — binds the global editor keymap to the runtime handles, and the page-wide
 * `dragover`/`drop` navigation guard (see {@link onGlobalDragOver}).
 *
 * On each `keydown` (outside a text field) it resolves the stroke to an action and dispatches: W/E/R/T →
 * `gizmos.setMode`; F → `camera.focus` (primary selection's position); Ctrl+D → `duplicate`; Del →
 * `delete`; Ctrl+Z/Y → `undo`/`redo`; Ctrl+S → `save`; Ctrl+A → `select` all. The latest snapshot is held
 * from the poll so selection-scoped actions target the current selection. Both listeners are released on
 * destroy.
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
    document.addEventListener("dragover", onGlobalDragOver);
    document.addEventListener("drop", onGlobalDrop);
    ctx.cleanup(() => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("dragover", onGlobalDragOver);
      document.removeEventListener("drop", onGlobalDrop);
    });
  }
});

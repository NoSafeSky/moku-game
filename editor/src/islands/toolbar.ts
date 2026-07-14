/** @file Toolbar island — undo/redo, play/stop/step, save/load; reflects canUndo/canRedo/mode. */
import { createIsland } from "@moku-labs/web/browser";

/**
 * Toolbar island — stub. W3 wires data-action clicks to getEditor().bridge (undo/redo/play/stop/
 * step/save/load) and reflects mode/canUndo/canRedo from onSnapshot.
 */
export const toolbar = createIsland("toolbar", {
  onMount() {
    throw new Error("[toolbar] not implemented");
  }
});

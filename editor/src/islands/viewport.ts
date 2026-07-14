/** @file Viewport island — pointer picking → selection.pickAt → selection.select + gizmos.enable. */
import { createIsland } from "@moku-labs/web/browser";

/**
 * Viewport island — stub. W3 wires pointer picking through getEditor().selection/gizmos and
 * gates gizmo redraws on snapshot.epoch via onSnapshot.
 */
export const viewport = createIsland("viewport", {
  onMount() {
    throw new Error("[viewport] not implemented");
  }
});

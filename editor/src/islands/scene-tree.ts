/** @file Scene-tree island — snapshot.entities → selectable rows → bridge.select. */
import { createIsland } from "@moku-labs/web/browser";

/**
 * Scene-tree island — stub. W3 wires onSnapshot → entity rows → getEditor().bridge.select,
 * gating the row rebuild on snapshot.epoch.
 */
export const sceneTree = createIsland("scene-tree", {
  onMount() {
    throw new Error("[scene-tree] not implemented");
  }
});

/** @file Inspector island — snapshot selection → renderControl per field → bridge.setField. */
import { createIsland } from "@moku-labs/web/browser";

/**
 * Inspector island — stub. W3 wires onSnapshot → field-controls (renderControl/readControl) →
 * getEditor().bridge.setField, gating rebuilds on snapshot.epoch.
 */
export const inspector = createIsland("inspector", {
  onMount() {
    throw new Error("[inspector] not implemented");
  }
});

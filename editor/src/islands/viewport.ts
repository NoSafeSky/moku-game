/** @file Viewport island — reflects the current selection; click-to-pick is owned by editor-selection. */
import { createIsland } from "@moku-labs/web/browser";
import type { EditorBridge } from "@nosafesky/ludemic";
import { onSnapshot } from "../lib/editor-host";

// Reflect whether anything is selected as data-has-selection — the DOM hook for a viewport focus ring.
const reflectSelection = (host: HTMLElement, snapshot: EditorBridge.EditorSnapshot): void => {
  host.toggleAttribute("data-has-selection", snapshot.selection.length > 0);
};

/**
 * Viewport island — mirrors the editor's current selection onto the panel that hosts the game canvas.
 *
 * Click-to-pick is deliberately NOT wired here: `editor-selection.enable()` (called once at boot in
 * `editor-host`) already attaches its own Pixi `pointerdown` listener that hit-tests the scene and drives
 * `select`/`clear` (and `toggle` under `multiSelect`). A second DOM listener would double the hit-test
 * and, once `multiSelect` ships, clobber the framework's `toggle` with a plain `select`. So the island's
 * only job is to reflect `snapshot.selection` as `data-has-selection` (a DOM focus ring; the in-canvas
 * highlight + translate gizmo are the selection/gizmos plugins' own overlays). The snapshot subscription
 * is released on destroy via `ctx.cleanup`.
 */
export const viewport = createIsland("viewport", {
  onMount(ctx) {
    const host = ctx.el as HTMLElement;
    ctx.cleanup(onSnapshot(snapshot => reflectSelection(host, snapshot)));
  }
});

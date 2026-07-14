/** @file Toolbar island — data-action buttons → bridge.*; reflects mode/canUndo/canRedo. */
import { createIsland } from "@moku-labs/web/browser";
import type { EditorBridge } from "@nosafesky/moku-game";
import { getEditor, onSnapshot } from "../lib/editor-host";

// The single named scene slot the MVP save/load buttons round-trip through.
const SCENE = "scene";

// Route one toolbar action to its bridge call (save/load use the single MVP scene slot). Every write
// goes through the bridge — the toolbar never touches editor-history/serialization/runtime directly.
const dispatch = (action: string): void => {
  const { bridge } = getEditor();
  switch (action) {
    case "undo": {
      bridge.undo();
      return;
    }
    case "redo": {
      bridge.redo();
      return;
    }
    case "play": {
      bridge.play();
      return;
    }
    case "stop": {
      bridge.stop();
      return;
    }
    case "step": {
      bridge.step();
      return;
    }
    case "save": {
      bridge.save(SCENE);
      return;
    }
    case "load": {
      bridge.load(SCENE);
      return;
    }
  }
};

// Toggle one action button's data-disabled flag (no-op when the button is absent from the chrome).
const setActionDisabled = (host: HTMLElement, action: string, disabled: boolean): void => {
  host.querySelector(`[data-action="${action}"]`)?.toggleAttribute("data-disabled", disabled);
};

// Reflect the cheap scalar snapshot onto the toolbar chrome — runs every poll (cheap scalars re-read
// fresh each frame, so a mode/undo/redo change surfaces on the next frame with no epoch gate).
const reflect = (host: HTMLElement, snapshot: EditorBridge.EditorSnapshot): void => {
  host.dataset.mode = snapshot.mode;
  setActionDisabled(host, "undo", !snapshot.canUndo);
  setActionDisabled(host, "redo", !snapshot.canRedo);
};

// Delegated toolbar click: route an enabled action button to its bridge call (a disabled one is ignored).
const onToolbarClick = (event: Event): void => {
  const node = event.target;
  if (!(node instanceof Element)) return;
  const button = node.closest<HTMLElement>("[data-action]");
  if (!button || button.dataset.disabled !== undefined) return;
  const action = button.dataset.action;
  if (action) dispatch(action);
};

/**
 * Toolbar island — dispatches the top-bar actions and mirrors the editor's mode + history state.
 *
 * A single delegated `click` routes each `data-action` button (undo/redo/play/stop/step/save/load)
 * to the matching `bridge.*` call; a disabled button (its `data-disabled` reflects `!canUndo`/`!canRedo`)
 * is ignored. Each poll reflects `snapshot.mode` onto the host (`data-mode="edit|play"`) so the active
 * mode reads as accented. All state is signalled via `data-*` (never `classList`); the snapshot
 * subscription + the click listener are released on destroy via `ctx.cleanup`.
 */
export const toolbar = createIsland("toolbar", {
  onMount(ctx) {
    const host = ctx.el as HTMLElement;

    ctx.cleanup(onSnapshot(snapshot => reflect(host, snapshot)));

    host.addEventListener("click", onToolbarClick);
    ctx.cleanup(() => host.removeEventListener("click", onToolbarClick));
  }
});

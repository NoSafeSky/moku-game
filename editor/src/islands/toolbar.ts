/**
 * @file Toolbar island — the transform-tool + transport strip. Tool / pivot / space buttons drive the
 * `editor-gizmos` handle directly (transient view state, off the poll+bridge path); the transport / history
 * / persistence buttons route through `editor-bridge`. Each poll reflects the cheap snapshot scalars
 * (mode / canUndo / canRedo) AND the live gizmo state (`mode()`/`pivot()`/`space()`) so a tool change made
 * with the keyboard (the `shortcuts` island's W/E/R/T) surfaces on the toolbar within a frame.
 */
import { createIsland } from "@moku-labs/web/browser";
import type { EditorBridge, EditorGizmos } from "@nosafesky/ludemic";
import { getEditor, onSnapshot } from "../lib/editor-host";

// The single named scene slot the MVP save/load buttons round-trip through.
const SCENE = "scene";

// The mode chip's label for each editor mode (design-context B2 — the EDIT/PLAY indicator).
const MODE_LABEL: Readonly<Record<string, string>> = { edit: "EDIT MODE", play: "PLAY MODE" };

// Route one bridge-backed action (transport / history / persistence) to its call. Every write goes through
// the bridge — the toolbar never touches editor-history / serialization / runtime directly.
const dispatch = (bridge: EditorBridge.Api, action: string): void => {
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

// Mark the one button in a group whose data-<attr> matches `value` as active (segmented / tool highlight).
const markActive = (host: HTMLElement, attr: string, value: string): void => {
  for (const button of host.querySelectorAll<HTMLElement>(`[${attr}]`)) {
    button.toggleAttribute("data-active", button.getAttribute(attr) === value);
  }
};

// Reflect the live gizmo state (read from the direct handle — it never rides the snapshot) onto the tool +
// segmented highlights. Reads the getters (cheap) each poll so a keyboard tool switch is mirrored here.
const reflectGizmos = (host: HTMLElement, gizmos: EditorGizmos.Api): void => {
  markActive(host, "data-tool", gizmos.mode());
  const pivotSegment = host.querySelector<HTMLElement>('[data-segment="pivot"]');
  const spaceSegment = host.querySelector<HTMLElement>('[data-segment="space"]');
  if (pivotSegment) markActive(pivotSegment, "data-segment-value", gizmos.pivot());
  if (spaceSegment) markActive(spaceSegment, "data-segment-value", gizmos.space());
};

/**
 * Toolbar island — dispatches the transform-tool + transport controls and mirrors editor state.
 *
 * A single delegated `click` routes each control: a `data-tool` button → `gizmos.setMode`, a pivot/space
 * `data-segment-value` button → `gizmos.setPivot`/`setSpace` (direct handles), and a `data-action` button
 * → the matching `bridge.*` (a `data-disabled` one is ignored). Each poll reflects `snapshot.mode` (chip +
 * host `data-mode`) and `canUndo`/`canRedo`, plus the live gizmo mode/pivot/space so keyboard tool changes
 * surface here too. All state is signalled via `data-*`; the subscription + click listener are released on
 * destroy via `ctx.cleanup`.
 */
export const toolbar = createIsland("toolbar", {
  onMount(ctx) {
    const host = ctx.el as HTMLElement;

    // Reflect the polled snapshot scalars (mode chip + history enablement) onto the chrome.
    const reflect = (snapshot: EditorBridge.EditorSnapshot): void => {
      host.dataset.mode = snapshot.mode;
      const chip = host.querySelector<HTMLElement>("[data-mode-chip]");
      if (chip) chip.textContent = MODE_LABEL[snapshot.mode] ?? snapshot.mode.toUpperCase();
      setActionDisabled(host, "undo", !snapshot.canUndo);
      setActionDisabled(host, "redo", !snapshot.canRedo);
      reflectGizmos(host, getEditor().gizmos);
    };

    // Show the initial tool/pivot/space highlight before the first poll (the handle is ready at hydration).
    reflectGizmos(host, getEditor().gizmos);
    ctx.cleanup(onSnapshot(reflect));

    const onClick = (event: Event): void => {
      const node = event.target;
      if (!(node instanceof Element)) return;

      // Transform tool → gizmos.setMode (echo the *actual* mode back, in case it was gated off).
      const tool = node.closest<HTMLElement>("[data-tool]");
      if (tool?.dataset.tool) {
        const { gizmos } = getEditor();
        gizmos.setMode(tool.dataset.tool as ReturnType<typeof gizmos.mode>);
        reflectGizmos(host, gizmos);
        return;
      }

      // Pivot / Space segmented control → gizmos.setPivot / setSpace.
      const segmentButton = node.closest<HTMLElement>("[data-segment-value]");
      if (segmentButton?.dataset.segmentValue) {
        const group = segmentButton.closest<HTMLElement>("[data-segment]")?.dataset.segment;
        const { gizmos } = getEditor();
        const value = segmentButton.dataset.segmentValue;
        if (group === "pivot") gizmos.setPivot(value as ReturnType<typeof gizmos.pivot>);
        else if (group === "space") gizmos.setSpace(value as ReturnType<typeof gizmos.space>);
        reflectGizmos(host, gizmos);
        return;
      }

      // Transport / history / persistence → bridge (a disabled button is inert).
      const actionButton = node.closest<HTMLElement>("[data-action]");
      if (
        actionButton &&
        actionButton.dataset.disabled === undefined &&
        actionButton.dataset.action
      ) {
        dispatch(getEditor().bridge, actionButton.dataset.action);
      }
    };

    host.addEventListener("click", onClick);
    ctx.cleanup(() => host.removeEventListener("click", onClick));
  }
});

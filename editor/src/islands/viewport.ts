/**
 * @file Viewport island — the Scene View overlay controls + selection/zoom readout. Click-to-pick and the
 * drag-marquee are owned by `editor-selection` (its own Pixi `pointerdown`), and the gizmo + outline are the
 * gizmos/selection plugins' overlays — so this island never wires a hit-test. Its jobs: reflect
 * `snapshot.selection` (a DOM focus ring), reflect `camera.getZoom()` into the readout, letterbox the stage
 * to the canvas aspect, and drive the overlay toolbar — grid (`renderer.setGridVisible`), snap
 * (`gizmos.setSnap`), zoom (`camera.zoomAt` / reset), and focus (`camera.focus`) — all direct handles, off
 * the poll+bridge path (they are transient view state, never undoable world writes).
 */
import { createIsland } from "@moku-labs/web/browser";
import type { Commands, EditorBridge } from "@nosafesky/ludemic";
import { getEditor, onSnapshot } from "../lib/editor-host";

// Editor grid overlay style — a slate hairline at a 32px world cell (design-context §5 CAD grid).
const GRID_SPEC = { size: 32, color: 0x3a_41_4b } as const;
// Snap increment (world units) applied to the active gizmo drag while Snap is on; 0 disables snapping.
const SNAP_STEP = 32;
// Multiplicative zoom step for the overlay +/− buttons (cursor-anchored on the stage centre).
const ZOOM_STEP = 1.2;

// The stage centre in renderer-screen coordinates — the anchor for cursor-anchored button zoom.
const stageCentre = (): { x: number; y: number } => {
  const view = getEditor().canvas;
  return { x: view.width / 2, y: view.height / 2 };
};

// The world point to frame on Focus: the primary selection's Transform position, if it has one.
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
 * Viewport island — mirrors selection + camera zoom onto the Scene View panel and wires its overlay toolbar.
 *
 * The one snapshot subscription reflects `data-has-selection` (a DOM focus ring, drawn so it never competes
 * with the in-canvas gizmo/outline overlay) and the live `camera.getZoom()` readout. A delegated click on
 * the overlay routes each `data-vp` control to its direct handle: Grid → `renderer.setGridVisible`, Snap →
 * `gizmos.setSnap`, zoom in/out/reset → `camera.zoomAt`/`setZoom`, Focus → `camera.focus` (primary
 * selection's position). The stage is letterboxed to the mounted canvas's aspect ratio. Grid starts on (the
 * CAD default). All listeners + the subscription are released on destroy via `ctx.cleanup`.
 */
export const viewport = createIsland("viewport", {
  onMount(ctx) {
    const host = ctx.el as HTMLElement;
    const stage = host.querySelector<HTMLElement>("[data-stage]");
    const zoomReadout = host.querySelector<HTMLElement>("[data-zoom]");

    // View-local toggle state (transient UI, never serialized — held in the island, mirrored to data-*).
    let gridOn = true;
    let snapOn = false;
    let snapshot: EditorBridge.EditorSnapshot | undefined;

    // Letterbox the stage to the canvas's intrinsic aspect so the game view is padded, never stretched
    // (the CSS fits `min(container-width, container-height × --aw/--ah)`; default 16:9 before it mounts).
    const canvas = stage?.querySelector<HTMLCanvasElement>("canvas");
    if (stage && canvas && canvas.height > 0) {
      stage.style.setProperty("--aw", String(canvas.width));
      stage.style.setProperty("--ah", String(canvas.height));
    }

    // Grid on by default (the CAD look); mirror the toggle to the handle + the button's data-on.
    const applyGrid = (): void => {
      getEditor().renderer.setGridVisible(gridOn, GRID_SPEC);
      host.querySelector("[data-vp='grid']")?.toggleAttribute("data-on", gridOn);
    };
    const applySnap = (): void => {
      getEditor().gizmos.setSnap(snapOn ? SNAP_STEP : 0);
      host.querySelector("[data-vp='snap']")?.toggleAttribute("data-on", snapOn);
    };
    applyGrid();
    applySnap();

    // Reflect the polled snapshot: the DOM focus ring + the live zoom readout (read from the camera handle).
    const reflect = (next: EditorBridge.EditorSnapshot): void => {
      snapshot = next;
      host.toggleAttribute("data-has-selection", next.selection.length > 0);
      if (zoomReadout) {
        zoomReadout.textContent = `${Math.round(getEditor().camera.getZoom() * 100)}%`;
      }
    };
    ctx.cleanup(onSnapshot(reflect));

    // Frame the primary selection (Focus / F): snap the camera to its Transform position.
    const focusSelection = (): void => {
      const first = snapshot?.selection[0];
      if (snapshot && first !== undefined) {
        const point = focusPointOf(snapshot, first);
        if (point) getEditor().camera.focus(point);
      }
    };

    const onOverlayClick = (event: Event): void => {
      const node = event.target;
      if (!(node instanceof Element)) return;
      const button = node.closest<HTMLElement>("[data-vp]");
      const control = button?.dataset.vp;
      if (!control) return;

      switch (control) {
        case "grid": {
          gridOn = !gridOn;
          applyGrid();
          return;
        }
        case "snap": {
          snapOn = !snapOn;
          applySnap();
          return;
        }
        case "zoom-in": {
          getEditor().camera.zoomAt(stageCentre(), ZOOM_STEP);
          return;
        }
        case "zoom-out": {
          getEditor().camera.zoomAt(stageCentre(), 1 / ZOOM_STEP);
          return;
        }
        case "zoom-reset": {
          getEditor().camera.setZoom(1);
          return;
        }
        case "focus": {
          focusSelection();
          return;
        }
      }
    };

    host.addEventListener("click", onOverlayClick);
    ctx.cleanup(() => host.removeEventListener("click", onOverlayClick));
  }
});

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
import { ASSET_DND_TYPE } from "../lib/asset-dnd";
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

// Map a drop event's page coordinates to a WORLD point (P2 drag-to-scene). The canvas's backing store
// (`width`/`height`, in device pixels) can differ from its CSS box, so scale the client offset by that
// ratio — DPR-correct — before handing renderer-screen coordinates to `camera.screenToWorld`.
const dropWorldPoint = (event: DragEvent): { x: number; y: number } => {
  const canvas = getEditor().canvas;
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
  const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
  const screen = {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY
  };
  return getEditor().camera.screenToWorld(screen);
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
 * CAD default). The stage is also the **drag-to-scene** drop target (P2): dropping an asset tile maps the
 * point to world coords (`camera.screenToWorld`, DPR-corrected) and `bridge.createSprite`s it, then selects
 * the new object — a world write, so it stays on the bridge. All listeners + the subscription are released on
 * destroy via `ctx.cleanup`.
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

    // ── Drag-to-scene drop target (design §F9) — the Scene View canvas instantiates a dragged asset. ──
    // Only an asset drag is accepted: dragover preventDefault (required to allow a drop) + the copy cursor
    // fire only when our custom type is present, so a stray text/file drop never spawns a sprite.
    const onDragOver = (event: DragEvent): void => {
      if (!event.dataTransfer?.types.includes(ASSET_DND_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      stage?.toggleAttribute("data-drop-target", true);
    };
    const onDragLeave = (): void => {
      stage?.toggleAttribute("data-drop-target", false);
    };
    // Drop: map the point to world coords, create a sprite bound to the alias (undo-tracked, via the bridge),
    // and select it. World writes stay on the bridge — the island never touches commands/ecs.
    const onDrop = (event: DragEvent): void => {
      stage?.toggleAttribute("data-drop-target", false);
      const alias = event.dataTransfer?.getData(ASSET_DND_TYPE);
      if (!alias) return;
      event.preventDefault();
      const point = dropWorldPoint(event);
      const { bridge } = getEditor();
      const id = bridge.createSprite(alias, { transform: { x: point.x, y: point.y } });
      bridge.select(id);
    };

    if (stage) {
      stage.addEventListener("dragover", onDragOver);
      stage.addEventListener("dragleave", onDragLeave);
      stage.addEventListener("drop", onDrop);
      ctx.cleanup(() => {
        stage.removeEventListener("dragover", onDragOver);
        stage.removeEventListener("dragleave", onDragLeave);
        stage.removeEventListener("drop", onDrop);
      });
    }
  }
});

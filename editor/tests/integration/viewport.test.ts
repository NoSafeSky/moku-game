// @vitest-environment happy-dom
import { mountIsland } from "@moku-labs/web/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { query } from "../helpers/dom";

// A controllable editor-host mock. The viewport island reflects the snapshot (selection ring + zoom
// readout) and drives the overlay controls through the direct handles: renderer.setGridVisible (grid),
// gizmos.setSnap (snap), camera.zoomAt/setZoom (zoom), camera.focus (Focus). It must NOT reach a selection
// picker — click-to-pick + the marquee are editor-selection.enable()'s job. vi.hoisted so it exists before
// the vi.mock factory references it.
const mocks = vi.hoisted(() => {
  const subscribers = new Set<(snapshot: unknown) => void>();
  const renderer = { setGridVisible: vi.fn() };
  const gizmos = { setSnap: vi.fn() };
  const camera = {
    getZoom: vi.fn(() => 1),
    zoomAt: vi.fn(),
    setZoom: vi.fn(),
    focus: vi.fn(),
    screenToWorld: vi.fn(() => ({ x: 100, y: 50 }))
  };
  const bridge = { createSprite: vi.fn(() => 42), select: vi.fn() };
  const canvas = {
    width: 800,
    height: 600,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 })
  } as unknown as HTMLCanvasElement;
  return {
    subscribers,
    renderer,
    gizmos,
    camera,
    bridge,
    canvas,
    getEditor: vi.fn(() => ({ renderer, gizmos, camera, bridge, canvas })),
    onSnapshot: vi.fn((fn: (snapshot: unknown) => void) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    })
  };
});

vi.mock("../../src/lib/editor-host", () => ({
  getEditor: mocks.getEditor,
  onSnapshot: mocks.onSnapshot
}));

const { viewport } = await import("../../src/islands/viewport");

// A fixture mirroring the SSG viewport chrome: the stage host + the two overlay control clusters.
const VIEWPORT_HTML = `
  <header data-vp-header><span data-vp-title>Scene View</span></header>
  <div data-vp-body>
    <div data-stage></div>
    <div data-vp-overlay data-corner="top">
      <button data-vp="grid">Grid</button>
      <button data-vp="snap">Snap</button>
    </div>
    <div data-vp-overlay data-corner="bottom">
      <button data-vp="zoom-out">–</button>
      <span data-zoom data-mono>100%</span>
      <button data-vp="zoom-in">+</button>
      <button data-vp="zoom-reset">1:1</button>
      <button data-vp="focus">Focus</button>
    </div>
  </div>
`;

const snap = (over: Record<string, unknown> = {}) => ({
  epoch: 0,
  entities: [] as { id: number; components: { name: string; value: unknown }[] }[],
  selection: [] as number[],
  mode: "edit",
  canUndo: false,
  canRedo: false,
  ...over
});
const push = (snapshot: unknown) => {
  for (const fn of mocks.subscribers) fn(snapshot);
};

afterEach(() => {
  mocks.subscribers.clear();
  vi.clearAllMocks();
});

describe("viewport island", () => {
  it("enables the grid + clears snap on mount (the CAD default)", () => {
    const handle = mountIsland(viewport, { html: VIEWPORT_HTML });

    expect(mocks.renderer.setGridVisible).toHaveBeenCalledWith(true, {
      size: 32,
      color: 0x3a_41_4b
    });
    expect(mocks.gizmos.setSnap).toHaveBeenCalledWith(0);
    expect(query(handle.el, "[data-vp='grid']").dataset.on).toBe("");
    expect(query(handle.el, "[data-vp='snap']").dataset.on).toBeUndefined();
  });

  it("reflects data-has-selection + the zoom readout from the snapshot each poll", () => {
    mocks.camera.getZoom.mockReturnValue(1.5);
    const handle = mountIsland(viewport, { html: VIEWPORT_HTML });

    push(snap({ selection: [1] }));
    expect(handle.el.dataset.hasSelection).toBe("");
    expect(query(handle.el, "[data-zoom]").textContent).toBe("150%");

    push(snap({ selection: [] }));
    expect(handle.el.dataset.hasSelection).toBeUndefined();
  });

  it("toggles the grid overlay via renderer.setGridVisible", () => {
    const handle = mountIsland(viewport, { html: VIEWPORT_HTML });
    mocks.renderer.setGridVisible.mockClear();

    handle.fire("click [data-vp='grid']"); // on → off
    expect(mocks.renderer.setGridVisible).toHaveBeenCalledWith(false, {
      size: 32,
      color: 0x3a_41_4b
    });
    expect(query(handle.el, "[data-vp='grid']").dataset.on).toBeUndefined();

    handle.fire("click [data-vp='grid']"); // off → on
    expect(mocks.renderer.setGridVisible).toHaveBeenLastCalledWith(true, {
      size: 32,
      color: 0x3a_41_4b
    });
    expect(query(handle.el, "[data-vp='grid']").dataset.on).toBe("");
  });

  it("toggles snap via gizmos.setSnap", () => {
    const handle = mountIsland(viewport, { html: VIEWPORT_HTML });
    mocks.gizmos.setSnap.mockClear();

    handle.fire("click [data-vp='snap']"); // off → on (32 world units)
    expect(mocks.gizmos.setSnap).toHaveBeenCalledWith(32);
    expect(query(handle.el, "[data-vp='snap']").dataset.on).toBe("");

    handle.fire("click [data-vp='snap']"); // on → off (0 disables)
    expect(mocks.gizmos.setSnap).toHaveBeenLastCalledWith(0);
  });

  it("drives the camera from the zoom controls (in / out cursor-anchored, reset to 100%)", () => {
    const handle = mountIsland(viewport, { html: VIEWPORT_HTML });

    handle.fire("click [data-vp='zoom-in']");
    expect(mocks.camera.zoomAt).toHaveBeenCalledWith({ x: 400, y: 300 }, 1.2);

    handle.fire("click [data-vp='zoom-out']");
    expect(mocks.camera.zoomAt).toHaveBeenLastCalledWith({ x: 400, y: 300 }, 1 / 1.2);

    handle.fire("click [data-vp='zoom-reset']");
    expect(mocks.camera.setZoom).toHaveBeenCalledWith(1);
  });

  it("frames the primary selection via camera.focus (its Transform position)", () => {
    const handle = mountIsland(viewport, { html: VIEWPORT_HTML });
    push(
      snap({
        selection: [1],
        entities: [{ id: 1, components: [{ name: "Transform", value: { x: 12, y: 5 } }] }]
      })
    );

    handle.fire("click [data-vp='focus']");

    expect(mocks.camera.focus).toHaveBeenCalledWith({ x: 12, y: 5 });
  });

  it("does not focus when nothing is selected", () => {
    const handle = mountIsland(viewport, { html: VIEWPORT_HTML });
    push(snap({ selection: [] }));

    handle.fire("click [data-vp='focus']");

    expect(mocks.camera.focus).not.toHaveBeenCalled();
  });

  it("does NOT wire its own picking — a bare pointerdown drives no handle", () => {
    const handle = mountIsland(viewport, { html: VIEWPORT_HTML });
    mocks.camera.zoomAt.mockClear();
    mocks.camera.focus.mockClear();
    mocks.camera.setZoom.mockClear();
    mocks.renderer.setGridVisible.mockClear();

    query(handle.el, "[data-stage]").dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true })
    );

    expect(mocks.camera.zoomAt).not.toHaveBeenCalled();
    expect(mocks.camera.focus).not.toHaveBeenCalled();
    expect(mocks.camera.setZoom).not.toHaveBeenCalled();
    expect(mocks.renderer.setGridVisible).not.toHaveBeenCalled();
  });

  it("accepts an asset dragover (preventDefault + copy cursor) and marks the stage a drop target", () => {
    const handle = mountIsland(viewport, { html: VIEWPORT_HTML });
    const stage = query(handle.el, "[data-stage]");

    const dataTransfer = {
      types: ["application/x-moku-asset"],
      dropEffect: ""
    } as unknown as DataTransfer;
    const event = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    stage.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(dataTransfer.dropEffect).toBe("copy");
    expect(stage.dataset.dropTarget).toBe("");
  });

  it("creates a sprite bound to the dropped alias at its world point, then selects it (drag-to-scene)", () => {
    const handle = mountIsland(viewport, { html: VIEWPORT_HTML });
    const stage = query(handle.el, "[data-stage]");

    const dataTransfer = {
      types: ["application/x-moku-asset"],
      getData: vi.fn((type: string) => (type === "application/x-moku-asset" ? "coin-a1" : ""))
    } as unknown as DataTransfer;
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    Object.defineProperty(event, "clientX", { value: 120 });
    Object.defineProperty(event, "clientY", { value: 60 });
    stage.dispatchEvent(event);

    // Canvas box == backing store (800×600, origin 0,0) → screen == client offset (scale 1).
    expect(mocks.camera.screenToWorld).toHaveBeenCalledWith({ x: 120, y: 60 });
    expect(mocks.bridge.createSprite).toHaveBeenCalledWith("coin-a1", {
      transform: { x: 100, y: 50 }
    });
    expect(mocks.bridge.select).toHaveBeenCalledWith(42);
    expect(stage.dataset.dropTarget).toBeUndefined();
  });

  it("ignores a non-asset drag — no preventDefault, and a stray drop spawns nothing", () => {
    const handle = mountIsland(viewport, { html: VIEWPORT_HTML });
    const stage = query(handle.el, "[data-stage]");

    const overTransfer = { types: ["text/plain"], dropEffect: "" } as unknown as DataTransfer;
    const over = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(over, "dataTransfer", { value: overTransfer });
    stage.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(false);

    const dropTransfer = {
      types: ["text/plain"],
      getData: vi.fn(() => "")
    } as unknown as DataTransfer;
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: dropTransfer });
    stage.dispatchEvent(drop);
    expect(mocks.bridge.createSprite).not.toHaveBeenCalled();
  });

  it("unsubscribes from the snapshot poll on unmount", () => {
    const handle = mountIsland(viewport, { html: VIEWPORT_HTML });
    expect(mocks.subscribers.size).toBe(1);

    handle.unmount();

    expect(mocks.subscribers.size).toBe(0);
  });
});

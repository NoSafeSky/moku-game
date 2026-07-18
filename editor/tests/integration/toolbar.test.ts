// @vitest-environment happy-dom
import { mountIsland } from "@moku-labs/web/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { query } from "../helpers/dom";

// A controllable editor-host mock: the toolbar dispatches through getEditor().bridge (transport/history/
// persistence) and getEditor().gizmos (tool/pivot/space, direct handles), reflecting the snapshot delivered
// via onSnapshot(). The gizmo getters are stateful so reflect() mirrors a setMode/setPivot/setSpace back.
// vi.hoisted so it precedes the vi.mock factory.
const mocks = vi.hoisted(() => {
  const subscribers = new Set<(snapshot: unknown) => void>();
  const bridge = {
    undo: vi.fn(),
    redo: vi.fn(),
    play: vi.fn(),
    stop: vi.fn(),
    step: vi.fn(),
    save: vi.fn(),
    load: vi.fn()
  };
  const gizmoState = { mode: "translate", pivot: "pivot", space: "global" };
  const gizmos = {
    mode: vi.fn(() => gizmoState.mode),
    pivot: vi.fn(() => gizmoState.pivot),
    space: vi.fn(() => gizmoState.space),
    setMode: vi.fn((mode: string) => {
      gizmoState.mode = mode;
    }),
    setPivot: vi.fn((pivot: string) => {
      gizmoState.pivot = pivot;
    }),
    setSpace: vi.fn((space: string) => {
      gizmoState.space = space;
    })
  };
  return {
    subscribers,
    bridge,
    gizmos,
    gizmoState,
    getEditor: vi.fn(() => ({ bridge, gizmos })),
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

const { toolbar } = await import("../../src/islands/toolbar");

// A fixture mirroring the SSG toolbar chrome: transform tools, pivot/space segments, transport + mode chip,
// history + persistence actions.
const TOOLBAR_HTML = `
  <div data-group="tools">
    <button data-tool="translate"><span data-tool-label>Move</span><span data-badge>W</span></button>
    <button data-tool="rotate">Rotate</button>
    <button data-tool="scale">Scale</button>
    <button data-tool="rect">Rect</button>
  </div>
  <div data-segment="pivot">
    <button data-segment-value="pivot">Pivot</button>
    <button data-segment-value="center">Center</button>
  </div>
  <div data-segment="space">
    <button data-segment-value="local">Local</button>
    <button data-segment-value="global">Global</button>
  </div>
  <div data-group="transport">
    <button data-action="play">Play</button>
    <button data-action="stop">Stop</button>
    <button data-action="step">Step</button>
    <span data-mode-chip>EDIT MODE</span>
  </div>
  <div data-group="history">
    <button data-action="undo">Undo</button>
    <button data-action="redo">Redo</button>
  </div>
  <div data-group="persistence">
    <button data-action="save">Save</button>
    <button data-action="load">Load</button>
  </div>
`;

const snap = (over: Record<string, unknown> = {}) => ({
  epoch: 0,
  entities: [],
  selection: [],
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
  mocks.gizmoState.mode = "translate";
  mocks.gizmoState.pivot = "pivot";
  mocks.gizmoState.space = "global";
  vi.clearAllMocks();
});

describe("toolbar island", () => {
  it("reflects mode (chip + host) + canUndo/canRedo each poll", () => {
    const handle = mountIsland(toolbar, { html: TOOLBAR_HTML });

    push(snap({ mode: "play", canUndo: true, canRedo: false }));

    expect(handle.el.dataset.mode).toBe("play");
    expect(query(handle.el, "[data-mode-chip]").textContent).toBe("PLAY MODE");
    expect(query(handle.el, "[data-action='undo']").dataset.disabled).toBeUndefined();
    expect(query(handle.el, "[data-action='redo']").dataset.disabled).toBe("");
  });

  it("reflects the live gizmo tool/pivot/space from the handle each poll", () => {
    const handle = mountIsland(toolbar, { html: TOOLBAR_HTML });
    mocks.gizmoState.mode = "rotate";
    mocks.gizmoState.pivot = "center";
    mocks.gizmoState.space = "local";

    push(snap());

    expect(query(handle.el, "[data-tool='rotate']").dataset.active).toBe("");
    expect(query(handle.el, "[data-tool='translate']").dataset.active).toBeUndefined();
    expect(query(handle.el, "[data-segment-value='center']").dataset.active).toBe("");
    expect(query(handle.el, "[data-segment-value='local']").dataset.active).toBe("");
  });

  it("routes a transform-tool button to gizmos.setMode + highlights the active tool", () => {
    const handle = mountIsland(toolbar, { html: TOOLBAR_HTML });

    handle.fire("click [data-tool='rotate']");

    expect(mocks.gizmos.setMode).toHaveBeenCalledWith("rotate");
    expect(query(handle.el, "[data-tool='rotate']").dataset.active).toBe("");
    expect(query(handle.el, "[data-tool='translate']").dataset.active).toBeUndefined();
  });

  it("routes the pivot/space segments to gizmos.setPivot / setSpace", () => {
    const handle = mountIsland(toolbar, { html: TOOLBAR_HTML });

    handle.fire("click [data-segment-value='center']");
    handle.fire("click [data-segment-value='local']");

    expect(mocks.gizmos.setPivot).toHaveBeenCalledWith("center");
    expect(mocks.gizmos.setSpace).toHaveBeenCalledWith("local");
  });

  it("dispatches each bridge-backed action button to the matching bridge call", () => {
    const handle = mountIsland(toolbar, { html: TOOLBAR_HTML });

    handle.fire("click [data-action='undo']");
    handle.fire("click [data-action='play']");
    handle.fire("click [data-action='step']");
    handle.fire("click [data-action='save']");
    handle.fire("click [data-action='load']");

    expect(mocks.bridge.undo).toHaveBeenCalledTimes(1);
    expect(mocks.bridge.play).toHaveBeenCalledTimes(1);
    expect(mocks.bridge.step).toHaveBeenCalledTimes(1);
    expect(mocks.bridge.save).toHaveBeenCalledWith("scene");
    expect(mocks.bridge.load).toHaveBeenCalledWith("scene");
  });

  it("ignores a click on a disabled action button", () => {
    const handle = mountIsland(toolbar, { html: TOOLBAR_HTML });
    push(snap({ canUndo: false })); // undo → data-disabled

    handle.fire("click [data-action='undo']");

    expect(mocks.bridge.undo).not.toHaveBeenCalled();
  });

  it("unsubscribes from the snapshot poll on unmount", () => {
    const handle = mountIsland(toolbar, { html: TOOLBAR_HTML });
    expect(mocks.subscribers.size).toBe(1);

    handle.unmount();

    expect(mocks.subscribers.size).toBe(0);
  });
});

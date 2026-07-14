// @vitest-environment happy-dom
import { mountIsland } from "@moku-labs/web/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { query } from "../helpers/dom";

// A controllable editor-host mock: the toolbar dispatches through getEditor().bridge and reflects the
// snapshot delivered via onSnapshot(). vi.hoisted so it precedes the vi.mock factory.
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
  return {
    subscribers,
    bridge,
    getEditor: vi.fn(() => ({ bridge })),
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

const TOOLBAR_HTML = ["undo", "redo", "play", "stop", "step", "save", "load"]
  .map(action => `<button data-action="${action}"></button>`)
  .join("");

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
  vi.clearAllMocks();
});

describe("toolbar island", () => {
  it("reflects mode + canUndo/canRedo onto the chrome each poll", () => {
    const handle = mountIsland(toolbar, { html: TOOLBAR_HTML });

    push(snap({ mode: "play", canUndo: true, canRedo: false }));

    expect(handle.el.dataset.mode).toBe("play");
    expect(query(handle.el, "[data-action='undo']").dataset.disabled).toBeUndefined();
    expect(query(handle.el, "[data-action='redo']").dataset.disabled).toBe("");
  });

  it("dispatches each data-action button to the matching bridge call", () => {
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

  it("ignores a click on a disabled button", () => {
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

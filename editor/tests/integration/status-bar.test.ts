// @vitest-environment happy-dom
import { mountIsland } from "@moku-labs/web/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { query } from "../helpers/dom";

// A controllable editor-host mock: the status bar reflects the snapshot delivered via onSnapshot().
const mocks = vi.hoisted(() => {
  const subscribers = new Set<(snapshot: unknown) => void>();
  return {
    subscribers,
    onSnapshot: vi.fn((fn: (snapshot: unknown) => void) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    })
  };
});

vi.mock("../../src/lib/editor-host", () => ({ onSnapshot: mocks.onSnapshot }));

const { statusBar } = await import("../../src/islands/status-bar");

const STATUS_HTML = "<div data-hints></div><span data-readout>—</span>";

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

describe("status-bar island", () => {
  it("fills the readout with object/selection counts + mode each poll", () => {
    const handle = mountIsland(statusBar, { html: STATUS_HTML });

    push(snap({ entities: [{ id: 1 }, { id: 2 }, { id: 3 }], selection: [2], mode: "edit" }));

    expect(query(handle.el, "[data-readout]").textContent).toBe("3 objects · 1 selected · EDIT");
    expect(handle.el.dataset.mode).toBe("edit");
  });

  it("reflects play mode onto the host + readout", () => {
    const handle = mountIsland(statusBar, { html: STATUS_HTML });

    push(snap({ entities: [{ id: 1 }], selection: [], mode: "play" }));

    expect(query(handle.el, "[data-readout]").textContent).toBe("1 objects · 0 selected · PLAY");
    expect(handle.el.dataset.mode).toBe("play");
  });

  it("unsubscribes from the snapshot poll on unmount", () => {
    const handle = mountIsland(statusBar, { html: STATUS_HTML });
    expect(mocks.subscribers.size).toBe(1);

    handle.unmount();

    expect(mocks.subscribers.size).toBe(0);
  });
});

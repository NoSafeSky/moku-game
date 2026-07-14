// @vitest-environment happy-dom
import { mountIsland } from "@moku-labs/web/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

// A controllable editor-host mock. The viewport island only consumes onSnapshot() to reflect the
// selection — it must NOT reach getEditor().selection for picking (that is editor-selection.enable()'s
// job). vi.hoisted so it exists before the vi.mock factory references it.
const mocks = vi.hoisted(() => {
  const subscribers = new Set<(snapshot: unknown) => void>();
  const selection = { pickAt: vi.fn(), select: vi.fn(), clear: vi.fn() };
  return {
    subscribers,
    selection,
    getEditor: vi.fn(() => ({ selection })),
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

describe("viewport island", () => {
  it("reflects data-has-selection from the snapshot each poll", () => {
    const handle = mountIsland(viewport, {});

    push(snap({ selection: [1] }));
    expect(handle.el.dataset.hasSelection).toBe("");

    push(snap({ selection: [] }));
    expect(handle.el.dataset.hasSelection).toBeUndefined();
  });

  it("does NOT wire its own picking — click→select is owned by editor-selection.enable()", () => {
    const handle = mountIsland(viewport, {});

    handle.el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));

    expect(mocks.getEditor).not.toHaveBeenCalled();
    expect(mocks.selection.pickAt).not.toHaveBeenCalled();
    expect(mocks.selection.select).not.toHaveBeenCalled();
    expect(mocks.selection.clear).not.toHaveBeenCalled();
  });

  it("unsubscribes from the snapshot poll on unmount", () => {
    const handle = mountIsland(viewport, {});
    expect(mocks.subscribers.size).toBe(1);

    handle.unmount();

    expect(mocks.subscribers.size).toBe(0);
  });
});

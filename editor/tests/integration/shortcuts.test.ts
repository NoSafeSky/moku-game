// @vitest-environment happy-dom
import { mountIsland } from "@moku-labs/web/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

// A controllable editor-host mock: the shortcuts island reads the snapshot from onSnapshot() and dispatches
// to getEditor()'s bridge / gizmos / camera handles. vi.hoisted so it precedes the vi.mock factory.
const mocks = vi.hoisted(() => {
  const subscribers = new Set<(snapshot: unknown) => void>();
  const bridge = {
    duplicate: vi.fn(),
    delete: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    save: vi.fn(),
    select: vi.fn()
  };
  const gizmos = { setMode: vi.fn() };
  const camera = { focus: vi.fn() };
  return {
    subscribers,
    bridge,
    gizmos,
    camera,
    getEditor: vi.fn(() => ({ bridge, gizmos, camera })),
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

const { shortcuts } = await import("../../src/islands/shortcuts");

const snap = (over: Record<string, unknown> = {}) => ({
  epoch: 1,
  roots: [] as number[],
  entities: [] as unknown[],
  selection: [] as number[],
  mode: "edit",
  canUndo: false,
  canRedo: false,
  ...over
});

// A world with one selected object carrying a Transform (so Focus has a point to frame).
const world = () =>
  snap({
    selection: [1],
    entities: [
      {
        id: 1,
        name: "A",
        enabled: true,
        parent: undefined,
        children: [],
        components: [{ name: "Transform", value: { x: 10, y: 20 }, fields: [] }]
      },
      { id: 2, name: "B", enabled: true, parent: undefined, children: [], components: [] }
    ]
  });

const push = (snapshot: unknown): void => {
  for (const fn of mocks.subscribers) fn(snapshot);
};

/** Dispatch a global keydown (target = document, i.e. not a text field) and return whether it was consumed. */
const key = (k: string, mods: Partial<KeyboardEventInit> = {}): boolean =>
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods })
  );

let handle: ReturnType<typeof mountIsland> | undefined;

afterEach(() => {
  handle?.unmount(); // release the global keydown listener
  handle = undefined;
  mocks.subscribers.clear();
  vi.clearAllMocks();
});

describe("shortcuts island", () => {
  it("maps W/E/R/T to gizmo modes", () => {
    handle = mountIsland(shortcuts, { html: "" });
    push(world());

    key("w");
    key("e");
    key("r");
    key("t");

    expect(mocks.gizmos.setMode.mock.calls).toEqual([
      ["translate"],
      ["rotate"],
      ["scale"],
      ["rect"]
    ]);
  });

  it("focuses the primary selection's transform position on F", () => {
    handle = mountIsland(shortcuts, { html: "" });
    push(world());

    key("f");

    expect(mocks.camera.focus).toHaveBeenCalledWith({ x: 10, y: 20 });
  });

  it("routes the bridge shortcuts (duplicate / delete / undo / redo / save / select-all)", () => {
    handle = mountIsland(shortcuts, { html: "" });
    push(world());

    key("d", { ctrlKey: true });
    expect(mocks.bridge.duplicate).toHaveBeenCalledWith(1);

    key("Delete");
    expect(mocks.bridge.delete).toHaveBeenCalledWith(1);

    key("z", { ctrlKey: true });
    expect(mocks.bridge.undo).toHaveBeenCalledTimes(1);

    key("z", { ctrlKey: true, shiftKey: true });
    expect(mocks.bridge.redo).toHaveBeenCalledTimes(1);

    key("s", { ctrlKey: true });
    expect(mocks.bridge.save).toHaveBeenCalledWith("scene");

    key("a", { ctrlKey: true });
    expect(mocks.bridge.select).toHaveBeenCalledWith(1, 2); // all ids
  });

  it("prevents the browser default for a handled shortcut", () => {
    handle = mountIsland(shortcuts, { html: "" });
    push(world());

    const consumed = key("s", { ctrlKey: true }); // dispatchEvent returns false when preventDefault ran
    expect(consumed).toBe(false);
  });

  it("ignores shortcuts while a text field has focus", () => {
    handle = mountIsland(shortcuts, { html: "" });
    push(world());

    const input = document.createElement("input");
    document.body.append(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));

    expect(mocks.gizmos.setMode).not.toHaveBeenCalled();
    input.remove();
  });

  it("no-ops before the first snapshot (nothing to act on)", () => {
    handle = mountIsland(shortcuts, { html: "" });

    key("w");

    expect(mocks.gizmos.setMode).not.toHaveBeenCalled();
  });
});

// @vitest-environment happy-dom
import { mountIsland } from "@moku-labs/web/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { query } from "../helpers/dom";

// A controllable editor-host mock: rows come from the snapshot delivered via onSnapshot(); a row click
// routes through getEditor().bridge.select. vi.hoisted so it precedes the vi.mock factory.
const mocks = vi.hoisted(() => {
  const subscribers = new Set<(snapshot: unknown) => void>();
  const bridge = { select: vi.fn() };
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

const { sceneTree } = await import("../../src/islands/scene-tree");

const entity = (id: number, ...names: string[]) => ({
  id,
  components: names.map(name => ({ name, value: {}, fields: [] }))
});
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

describe("scene-tree island", () => {
  it("renders one row per entity, labelled with id + component names", () => {
    const handle = mountIsland(sceneTree, { html: "<ul data-tree></ul>" });

    push(snap({ epoch: 1, entities: [entity(1, "Transform"), entity(2, "Transform", "Sprite")] }));

    const rows = handle.el.querySelectorAll("[data-tree] > li");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("#1");
    expect(rows[1]?.textContent).toContain("Sprite");
  });

  it("does not rebuild the rows when the epoch is unchanged", () => {
    const handle = mountIsland(sceneTree, { html: "<ul data-tree></ul>" });
    push(snap({ epoch: 1, entities: [entity(1, "Transform")] }));
    const firstRow = query(handle.el, "[data-tree] > li");

    push(snap({ epoch: 1, entities: [entity(1, "Transform")] })); // same epoch, fresh array

    expect(query(handle.el, "[data-tree] > li")).toBe(firstRow); // identity preserved → not rebuilt
  });

  it("reflects the selection as data-selected every poll (selection never bumps the epoch)", () => {
    const handle = mountIsland(sceneTree, { html: "<ul data-tree></ul>" });
    push(snap({ epoch: 1, entities: [entity(1), entity(2)], selection: [] }));
    expect(query(handle.el, "[data-id='1']").dataset.selected).toBeUndefined();

    push(snap({ epoch: 1, entities: [entity(1), entity(2)], selection: [2] })); // same epoch, new selection

    expect(query(handle.el, "[data-id='2']").dataset.selected).toBe("");
    expect(query(handle.el, "[data-id='1']").dataset.selected).toBeUndefined();
  });

  it("routes a row click to bridge.select with the branded id it was built from", () => {
    const handle = mountIsland(sceneTree, { html: "<ul data-tree></ul>" });
    push(snap({ epoch: 1, entities: [entity(7, "Transform")] }));

    handle.fire("click [data-id='7']");

    expect(mocks.bridge.select).toHaveBeenCalledWith(7);
  });

  it("unsubscribes on unmount", () => {
    const handle = mountIsland(sceneTree, { html: "<ul data-tree></ul>" });
    expect(mocks.subscribers.size).toBe(1);

    handle.unmount();

    expect(mocks.subscribers.size).toBe(0);
  });
});

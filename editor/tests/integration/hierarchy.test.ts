// @vitest-environment happy-dom
import { mountIsland } from "@moku-labs/web/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { query } from "../helpers/dom";

// A controllable editor-host mock: the island drives selection/rename/etc. through getEditor().bridge, and
// reads the world from snapshots pushed via onSnapshot(). vi.hoisted so it precedes the vi.mock factory.
const mocks = vi.hoisted(() => {
  const subscribers = new Set<(snapshot: unknown) => void>();
  const bridge = {
    select: vi.fn(),
    setEnabled: vi.fn(),
    rename: vi.fn(),
    duplicate: vi.fn(),
    delete: vi.fn(),
    create: vi.fn(),
    reparent: vi.fn(),
    reorder: vi.fn()
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

const { hierarchy } = await import("../../src/islands/hierarchy");

/** The panel shell the island hydrates (header actions + search + tree container). */
const HTML = `
  <header><div data-actions>
    <button data-action="create"></button>
    <button data-action="duplicate"></button>
    <button data-action="delete"></button>
  </div></header>
  <div data-search-row><input data-search /></div>
  <div data-tree role="tree" tabindex="0"></div>
`;

const comp = (name: string) => ({ name, value: {}, fields: [] });
const entity = (id: number, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  enabled: true,
  parent: undefined,
  children: [],
  components: [],
  ...over
});
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

// A small nested world:  Environment(1) → [Ground(3, disabled, Shape)] ,  Player(2, Shape)  at root.
const world = (over: Record<string, unknown> = {}) =>
  snap({
    roots: [1, 2],
    entities: [
      entity(1, "Environment", { children: [3] }),
      entity(3, "Ground", { parent: 1, enabled: false, components: [comp("Shape")] }),
      entity(2, "Player", { components: [comp("Shape")] })
    ],
    ...over
  });

const push = (snapshot: unknown): void => {
  for (const fn of mocks.subscribers) fn(snapshot);
};

const rows = (el: ParentNode): HTMLElement[] => [
  ...el.querySelectorAll<HTMLElement>("[data-tree] [data-row]")
];
const rowById = (el: ParentNode, id: number): HTMLElement =>
  query(el, `[data-tree] [data-row][data-id="${id}"]`);

/** Find a context-menu button by its label. */
const menuItem = (root: ParentNode, label: string): HTMLButtonElement | undefined =>
  [...(root.querySelector("[data-context-menu]")?.querySelectorAll("button") ?? [])].find(
    button => button.textContent === label
  ) as HTMLButtonElement | undefined;

/** A stub bounding box so drag-zone math is deterministic under happy-dom (which measures everything as 0). */
const stubRect = (top: number, height: number) =>
  ({
    top,
    height,
    left: 0,
    right: 0,
    bottom: top + height,
    width: 0,
    x: 0,
    y: top,
    toJSON: () => ({})
  }) as DOMRect;

afterEach(() => {
  mocks.subscribers.clear();
  vi.clearAllMocks();
});

describe("hierarchy island", () => {
  it("renders the nested tree — indented rows, names, summaries, disabled state", () => {
    const handle = mountIsland(hierarchy, { html: HTML });
    push(world());

    const all = rows(handle.el);
    expect(all.map(r => r.dataset.id)).toEqual(["1", "3", "2"]); // Environment, Ground (nested), Player

    const ground = rowById(handle.el, 3);
    expect(ground.style.getPropertyValue("--level")).toBe("1"); // one level deep
    expect(ground.dataset.enabled).toBe("false"); // seeded disabled
    expect(query(ground, "[data-summary]").textContent).toBe("Shape");
    expect(Object.hasOwn(query(rowById(handle.el, 1), "[data-twisty]").dataset, "leaf")).toBe(
      false
    ); // a folder
  });

  it("does not rebuild the rows when the epoch is unchanged", () => {
    const handle = mountIsland(hierarchy, { html: HTML });
    push(world());
    const first = rowById(handle.el, 1);

    push(world()); // same epoch, fresh objects

    expect(rowById(handle.el, 1)).toBe(first); // identity preserved → not rebuilt
  });

  it("routes a plain row click to bridge.select", () => {
    const handle = mountIsland(hierarchy, { html: HTML });
    push(world());

    query(rowById(handle.el, 2), "[data-name]").dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );

    expect(mocks.bridge.select).toHaveBeenCalledWith(2);
  });

  it("toggles into a multi-selection on Ctrl-click", () => {
    const handle = mountIsland(hierarchy, { html: HTML });
    push(world({ selection: [1] }));

    query(rowById(handle.el, 2), "[data-name]").dispatchEvent(
      new MouseEvent("click", { bubbles: true, ctrlKey: true })
    );

    expect(mocks.bridge.select).toHaveBeenCalledWith(1, 2);
  });

  it("selects the contiguous range on Shift-click", () => {
    const handle = mountIsland(hierarchy, { html: HTML });
    push(world());

    // Plain-click Environment (anchor), then Shift-click Player → the whole visible range.
    query(rowById(handle.el, 1), "[data-name]").dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    query(rowById(handle.el, 2), "[data-name]").dispatchEvent(
      new MouseEvent("click", { bubbles: true, shiftKey: true })
    );

    expect(mocks.bridge.select).toHaveBeenLastCalledWith(1, 3, 2);
  });

  it("toggles a row's enabled flag via the eye", () => {
    const handle = mountIsland(hierarchy, { html: HTML });
    push(world());

    query(rowById(handle.el, 3), "[data-eye]").dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );

    expect(mocks.bridge.setEnabled).toHaveBeenCalledWith(3, true); // Ground was disabled → re-enable
  });

  it("collapses a folder when its twisty is clicked", () => {
    const handle = mountIsland(hierarchy, { html: HTML });
    push(world());
    expect(rows(handle.el)).toHaveLength(3);

    query(rowById(handle.el, 1), "[data-twisty]").dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );

    expect(rows(handle.el).map(r => r.dataset.id)).toEqual(["1", "2"]); // Ground hidden under collapsed Environment
  });

  it("renames a row inline — double-click, type, Enter → bridge.rename", () => {
    const handle = mountIsland(hierarchy, { html: HTML });
    push(world());

    query(rowById(handle.el, 2), "[data-name]").dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true })
    );
    const input = query<HTMLInputElement>(handle.el, "[data-name-input]");
    input.value = "Hero";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(mocks.bridge.rename).toHaveBeenCalledWith(2, "Hero");
  });

  it("opens a context menu that dispatches the bridge verbs", () => {
    const handle = mountIsland(hierarchy, { html: HTML });
    push(world());

    rowById(handle.el, 3).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    expect(mocks.bridge.select).toHaveBeenCalledWith(3); // right-click auto-selects
    menuItem(handle.el, "Duplicate")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(mocks.bridge.duplicate).toHaveBeenCalledWith(3);

    // The menu closes on selection; re-open for a second verb.
    rowById(handle.el, 3).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    menuItem(handle.el, "Create Child")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(mocks.bridge.create).toHaveBeenCalledWith({ parent: 3 });
  });

  it("filters the tree to matching names via the search box", () => {
    const handle = mountIsland(hierarchy, { html: HTML });
    push(world());

    const search = query<HTMLInputElement>(handle.el, "[data-search]");
    search.value = "Player";
    search.dispatchEvent(new Event("input", { bubbles: true }));

    const shown = rows(handle.el);
    expect(shown).toHaveLength(1);
    expect(query(shown[0] as HTMLElement, "[data-name]").textContent).toBe("Player");
  });

  it("re-parents on a drag-drop, mapping the drop zone to bridge.reparent", () => {
    const handle = mountIsland(hierarchy, { html: HTML });
    push(world());

    const player = rowById(handle.el, 2);
    const environment = rowById(handle.el, 1);
    // Stub the target's box so the pointer lands in its middle (inside) band.
    environment.getBoundingClientRect = () => stubRect(0, 24);

    player.dispatchEvent(new MouseEvent("dragstart", { bubbles: true }));
    environment.dispatchEvent(new MouseEvent("drop", { bubbles: true, clientY: 12 }));

    expect(mocks.bridge.reparent).toHaveBeenCalledWith(2, 1, {});
  });

  it("drives create / duplicate / delete from the header buttons", () => {
    const handle = mountIsland(hierarchy, { html: HTML });
    push(world({ selection: [2] }));

    query(handle.el, '[data-action="create"]').dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    expect(mocks.bridge.create).toHaveBeenCalledTimes(1);

    query(handle.el, '[data-action="delete"]').dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    expect(mocks.bridge.delete).toHaveBeenCalledWith(2);
  });

  it("unsubscribes on unmount", () => {
    const handle = mountIsland(hierarchy, { html: HTML });
    expect(mocks.subscribers.size).toBe(1);

    handle.unmount();

    expect(mocks.subscribers.size).toBe(0);
  });
});

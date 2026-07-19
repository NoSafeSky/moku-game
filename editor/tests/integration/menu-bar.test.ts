// @vitest-environment happy-dom
import { mountIsland } from "@moku-labs/web/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { query } from "../helpers/dom";

// A controllable editor-host mock: the menu-bar dispatches through getEditor().bridge and reads
// getEditor().assets for Create Sprite; menu state (disabled/dirty) reflects the snapshot delivered via
// onSnapshot(). vi.hoisted so it precedes the vi.mock factory.
const mocks = vi.hoisted(() => {
  const subscribers = new Set<(snapshot: unknown) => void>();
  const bridge = {
    create: vi.fn(),
    createShape: vi.fn(),
    createSprite: vi.fn(),
    duplicate: vi.fn(),
    delete: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    select: vi.fn()
  };
  const assets = { entries: vi.fn(() => [] as { alias: string; loaded: boolean }[]) };
  return {
    subscribers,
    bridge,
    assets,
    getEditor: vi.fn(() => ({ bridge, assets })),
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

const { menuBar } = await import("../../src/islands/menu-bar");

const MENUBAR_HTML = `
  <strong data-brand>Moku Editor</strong>
  <nav data-menus>
    <button data-menu="gameobject">GameObject</button>
    <button data-menu="edit">Edit</button>
    <button data-menu="assets">Assets</button>
    <button data-menu="window">Window</button>
  </nav>
  <div data-scene>
    <span data-scene-name>untitled</span>
    <span data-dirty hidden>●</span>
  </div>
`;

const snap = (over: Record<string, unknown> = {}) => ({
  epoch: 0,
  entities: [],
  roots: [],
  selection: [],
  mode: "edit",
  canUndo: false,
  canRedo: false,
  ...over
});
const push = (snapshot: unknown) => {
  for (const fn of mocks.subscribers) fn(snapshot);
};
const mount = () => mountIsland(menuBar, { html: MENUBAR_HTML });

// Find one dropdown row by its visible label.
const itemByLabel = (root: ParentNode, label: string): HTMLButtonElement | undefined =>
  [...root.querySelectorAll<HTMLButtonElement>("[data-dropdown] [data-item]")].find(button =>
    button.textContent?.includes(label)
  );

afterEach(() => {
  mocks.subscribers.clear();
  vi.clearAllMocks();
});

describe("menu-bar island", () => {
  it("sets the scene name and marks the scene dirty once the epoch advances", () => {
    const handle = mount();

    push(snap({ epoch: 5 }));
    expect(query(handle.el, "[data-scene-name]").textContent).toBe("Level_01_Rooftops");
    expect(query(handle.el, "[data-dirty]").hasAttribute("hidden")).toBe(true);

    push(snap({ epoch: 6 }));
    expect(query(handle.el, "[data-dirty]").hasAttribute("hidden")).toBe(false);
  });

  it("opens the GameObject menu and routes Create Empty → bridge.create", () => {
    const handle = mount();
    push(snap());

    query(handle.el, "[data-menu='gameobject']").dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    itemByLabel(handle.el, "Create Empty")?.click();

    expect(mocks.bridge.create).toHaveBeenCalledTimes(1);
  });

  it("disables Create Child with no selection", () => {
    const handle = mount();
    push(snap({ selection: [] }));

    query(handle.el, "[data-menu='gameobject']").dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );

    expect(itemByLabel(handle.el, "Create Child")?.disabled).toBe(true);
  });

  it("routes Create Child → create({ parent }) with a selection", () => {
    const handle = mount();
    push(snap({ selection: [3] }));

    query(handle.el, "[data-menu='gameobject']").dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    itemByLabel(handle.el, "Create Child")?.click();

    expect(mocks.bridge.create).toHaveBeenCalledWith({ parent: 3 });
  });

  it("reflects canUndo/canRedo and routes Undo + Select All in the Edit menu", () => {
    const handle = mount();
    push(snap({ canUndo: true, canRedo: false, entities: [{ id: 1 }, { id: 2 }] }));

    query(handle.el, "[data-menu='edit']").dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    expect(itemByLabel(handle.el, "Undo")?.disabled).toBe(false);
    expect(itemByLabel(handle.el, "Redo")?.disabled).toBe(true);

    itemByLabel(handle.el, "Undo")?.click();
    expect(mocks.bridge.undo).toHaveBeenCalledTimes(1);

    query(handle.el, "[data-menu='edit']").dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    itemByLabel(handle.el, "Select All")?.click();
    expect(mocks.bridge.select).toHaveBeenCalledWith(1, 2);
  });

  it("toggles a panel's visibility from the Window menu", () => {
    const handle = mount();
    // Append the target panel AFTER mount (mountIsland resets document.body).
    const panel = document.createElement("section");
    panel.dataset.island = "inspector";
    document.body.append(panel);
    push(snap());

    query(handle.el, "[data-menu='window']").dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    // Visible by default → the item is checked.
    expect(itemByLabel(handle.el, "Inspector")?.dataset.checked).toBe("");
    itemByLabel(handle.el, "Inspector")?.click();

    expect(panel.style.display).toBe("none");
    panel.remove();
  });

  it("opens Assets and routes Import New Asset… to the asset browser's file input (P2)", () => {
    const handle = mount();
    // The asset-browser panel (with its hidden import input) lives elsewhere in the document.
    const panel = document.createElement("section");
    panel.dataset.island = "asset-browser";
    const input = document.createElement("input");
    input.type = "file";
    input.dataset.action = "import-input";
    const click = vi.fn();
    input.click = click;
    panel.append(input);
    document.body.append(panel);
    push(snap());

    query(handle.el, "[data-menu='assets']").dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    expect(handle.el.querySelector("[data-dropdown]")).not.toBeNull();
    // Create ▸ / Reimport All stay disabled stubs.
    expect(itemByLabel(handle.el, "Reimport All")?.disabled).toBe(true);

    itemByLabel(handle.el, "Import New Asset…")?.click();
    expect(click).toHaveBeenCalledTimes(1);
    panel.remove();
  });

  it("hover-switches to another top-level while a menu is open", () => {
    const handle = mount();
    push(snap());

    query(handle.el, "[data-menu='gameobject']").dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    query(handle.el, "[data-menu='edit']").dispatchEvent(
      new MouseEvent("pointerover", { bubbles: true })
    );

    // The Edit menu is now open (its rows show Undo, not Create Empty).
    expect(itemByLabel(handle.el, "Undo")).toBeTruthy();
    expect(handle.el.querySelector<HTMLElement>("[data-menu='edit']")?.dataset.open).toBe("");
  });

  it("unsubscribes from the snapshot poll on unmount", () => {
    const handle = mount();
    expect(mocks.subscribers.size).toBe(1);

    handle.unmount();

    expect(mocks.subscribers.size).toBe(0);
  });
});

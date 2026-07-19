// @vitest-environment happy-dom
import { mountIsland } from "@moku-labs/web/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { query } from "../helpers/dom";

// A controllable editor-host mock: controls come from the snapshot delivered via onSnapshot(); writes
// route through getEditor().bridge; the reference picker sources candidates from the snapshot / assets.
// vi.hoisted so it precedes the vi.mock factory.
const mocks = vi.hoisted(() => {
  const subscribers = new Set<(snapshot: unknown) => void>();
  const catalog = [
    {
      name: "Transform",
      category: "Transform",
      defaults: { x: 0, visible: true },
      addable: false,
      fields: []
    },
    {
      name: "SpriteRenderer",
      category: "Rendering",
      defaults: { tint: "#ffffff" },
      addable: true,
      fields: []
    },
    {
      name: "Shape",
      category: "Rendering",
      defaults: { fill: "#cccccc" },
      addable: true,
      fields: []
    }
  ];
  const bridge = {
    setField: vi.fn<(...args: unknown[]) => { ok: true } | { ok: false; error: string }>(() => ({
      ok: true
    })),
    setEnabled: vi.fn(),
    rename: vi.fn(),
    addComponent: vi.fn(),
    removeComponent: vi.fn(),
    listComponents: vi.fn(() => catalog)
  };
  const assets = { entries: vi.fn(() => [] as { alias: string; loaded: boolean }[]) };
  const assetStore = {
    entries: vi.fn(
      () => [] as { alias: string; name: string; mime: string; byteLength: number; url?: string }[]
    )
  };
  return {
    subscribers,
    bridge,
    assets,
    assetStore,
    getEditor: vi.fn(() => ({ bridge, assets, assetStore })),
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

const { inspector } = await import("../../src/islands/inspector");

// EntitySnapshot fixtures (hierarchical shape: name/enabled/parent/children/components).
const entity = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: "Drone",
  enabled: true,
  parent: undefined,
  children: [],
  components: [],
  ...over
});
const transformOf = (x: number, visible: boolean) => ({
  name: "Transform",
  value: { x, visible },
  fields: [
    { kind: "number", key: "x", label: "X" },
    { kind: "boolean", key: "visible", label: "Visible" }
  ]
});
const scriptOf = (target: number | undefined) => ({
  name: "Script",
  value: { target },
  fields: [{ kind: "entity-ref", key: "target", label: "Target" }]
});
const shapeOf = () => ({
  name: "Shape",
  value: { fill: "#cccccc" },
  fields: [{ kind: "color", key: "fill", label: "Fill" }]
});
const spriteOf = (sprite: string | undefined) => ({
  name: "SpriteRenderer",
  value: { sprite },
  fields: [{ kind: "asset-ref", key: "sprite", label: "Sprite" }]
});

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
const mount = () => mountIsland(inspector, { html: "<div data-body></div>" });

afterEach(() => {
  mocks.subscribers.clear();
  vi.clearAllMocks();
  for (const node of document.querySelectorAll("[data-ref-picker]")) node.remove();
});

describe("inspector island", () => {
  it("shows the no-selection empty state when nothing is selected", () => {
    const handle = mount();

    push(snap({ epoch: 1, entities: [entity()], selection: [] }));

    expect(query(handle.el, "[data-empty-state]").textContent).toContain("No object selected");
  });

  it("renders an object header + a section per component seeded from its value", () => {
    const handle = mount();

    push(
      snap({
        epoch: 1,
        entities: [entity({ components: [transformOf(10, true)] })],
        selection: [1]
      })
    );

    expect(query<HTMLInputElement>(handle.el, "[data-object-header] [data-name]").value).toBe(
      "Drone"
    );
    expect(
      query(handle.el, "[data-section][data-component='Transform'] [data-section-name]").textContent
    ).toBe("Transform");
    expect(query<HTMLInputElement>(handle.el, "[data-field-key='x']").value).toBe("10");
    expect(query<HTMLInputElement>(handle.el, "[data-field-key='visible']").checked).toBe(true);
  });

  it("routes a field control change through bridge.setField(id, component, key, value)", () => {
    const handle = mount();
    push(
      snap({
        epoch: 1,
        entities: [entity({ components: [transformOf(10, true)] })],
        selection: [1]
      })
    );

    const x = query<HTMLInputElement>(handle.el, "[data-field-key='x']");
    x.value = "42";
    x.dispatchEvent(new Event("change", { bubbles: true }));

    expect(mocks.bridge.setField).toHaveBeenCalledWith(1, "Transform", "x", 42);
  });

  it("flags the control data-invalid with the reason when the write is rejected", () => {
    mocks.bridge.setField.mockReturnValueOnce({ ok: false, error: "out of range" });
    const handle = mount();
    push(
      snap({
        epoch: 1,
        entities: [entity({ components: [transformOf(10, true)] })],
        selection: [1]
      })
    );

    const x = query<HTMLInputElement>(handle.el, "[data-field-key='x']");
    x.value = "999";
    x.dispatchEvent(new Event("change", { bubbles: true }));

    expect(x.dataset.invalid).toBe("");
    expect(x.title).toBe("out of range");
  });

  it("routes the object header enable checkbox → setEnabled and name field → rename", () => {
    const handle = mount();
    push(
      snap({
        epoch: 1,
        entities: [entity({ components: [transformOf(10, true)] })],
        selection: [1]
      })
    );

    const enable = query<HTMLInputElement>(handle.el, "[data-object-header] [data-enable]");
    enable.checked = false;
    enable.dispatchEvent(new Event("change", { bubbles: true }));
    const name = query<HTMLInputElement>(handle.el, "[data-object-header] [data-name]");
    name.value = "Drone_02";
    name.dispatchEvent(new Event("change", { bubbles: true }));

    expect(mocks.bridge.setEnabled).toHaveBeenCalledWith(1, false);
    expect(mocks.bridge.rename).toHaveBeenCalledWith(1, "Drone_02");
  });

  it("toggles a component section collapsed when its header is clicked", () => {
    const handle = mount();
    push(
      snap({
        epoch: 1,
        entities: [entity({ components: [transformOf(10, true)] })],
        selection: [1]
      })
    );

    const section = query(handle.el, "[data-section][data-component='Transform']");
    query(section, "[data-section-header]").dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );

    expect(section.dataset.collapsed).toBe("");
  });

  it("opens the kebab menu and removes a removable component; disables Remove for Transform", () => {
    const handle = mount();
    push(
      snap({
        epoch: 1,
        entities: [entity({ components: [transformOf(10, true), shapeOf()] })],
        selection: [1]
      })
    );

    // Transform (catalog addable:false) → Remove disabled.
    query(handle.el, "[data-section][data-component='Transform'] [data-kebab]").dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    const transformRemove = [
      ...handle.el.querySelectorAll<HTMLButtonElement>("[data-kebab-menu] button")
    ].find(button => button.textContent === "Remove Component");
    expect(transformRemove?.disabled).toBe(true);

    // Shape (addable) → Remove enabled → routes removeComponent.
    query(handle.el, "[data-section][data-component='Shape'] [data-kebab]").dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    const shapeRemove = [
      ...handle.el.querySelectorAll<HTMLButtonElement>("[data-kebab-menu] button")
    ].find(button => button.textContent === "Remove Component");
    shapeRemove?.click();

    expect(mocks.bridge.removeComponent).toHaveBeenCalledWith(1, "Shape");
  });

  it("opens the Add-Component picker (addable + not-present) and adds the picked component", () => {
    const handle = mount();
    push(
      snap({
        epoch: 1,
        entities: [entity({ components: [transformOf(10, true)] })],
        selection: [1]
      })
    );

    query(handle.el, "[data-add-component]").dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );

    const options = [
      ...handle.el.querySelectorAll<HTMLButtonElement>("[data-add-picker] [data-add-option]")
    ];
    // SpriteRenderer + Shape are addable and not present; Transform (non-addable) is excluded.
    expect(options.map(option => option.dataset.component)).toEqual(["SpriteRenderer", "Shape"]);
    options[0]?.click();

    expect(mocks.bridge.addComponent).toHaveBeenCalledWith(1, "SpriteRenderer");
  });

  it("opens the reference picker for an entity-ref and sets the field via setField", () => {
    const handle = mount();
    push(
      snap({
        epoch: 1,
        entities: [
          entity({ components: [scriptOf(undefined)] }),
          entity({ id: 2, name: "Player" })
        ],
        selection: [1]
      })
    );

    query(handle.el, "[data-field-key='target'] [data-ref-pick]").dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    // Candidates exclude self (id 1); "Player" (id 2) picks its id.
    const player = [
      ...handle.el.querySelectorAll<HTMLButtonElement>("[data-ref-picker] [data-ref-option]")
    ].find(option => option.textContent === "Player");
    player?.click();

    expect(mocks.bridge.setField).toHaveBeenCalledWith(1, "Script", "target", 2);
  });

  it("merges manifest + imported-store aliases into the asset-ref picker (deduped, manifest-first)", () => {
    mocks.assets.entries.mockReturnValue([{ alias: "hero", loaded: true }]);
    mocks.assetStore.entries.mockReturnValue([
      { alias: "coin-a1", name: "coin.png", mime: "image/png", byteLength: 10, url: "blob:coin" },
      { alias: "hero", name: "hero.png", mime: "image/png", byteLength: 20, url: "blob:hero" }
    ]);
    const handle = mount();
    push(
      snap({ epoch: 1, entities: [entity({ components: [spriteOf(undefined)] })], selection: [1] })
    );

    query(handle.el, "[data-field-key='sprite'] [data-ref-pick]").dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );

    const options = [
      ...handle.el.querySelectorAll<HTMLButtonElement>("[data-ref-picker] [data-ref-option]")
    ];
    // "None" + hero (manifest, deduped away from the store's hero) + coin-a1 (imported).
    expect(options.map(option => option.textContent)).toEqual(["None", "hero", "coin-a1"]);

    options.find(option => option.textContent === "coin-a1")?.click();
    expect(mocks.bridge.setField).toHaveBeenCalledWith(1, "SpriteRenderer", "sprite", "coin-a1");
  });

  it("shows the multi-object header + shared components, with divergent fields as '—'", () => {
    const handle = mount();
    push(
      snap({
        epoch: 1,
        entities: [
          entity({ id: 1, components: [transformOf(10, true)] }),
          entity({ id: 2, components: [transformOf(20, true)] })
        ],
        selection: [1, 2]
      })
    );

    expect(query(handle.el, "[data-multi-header]").textContent).toBe("2 Objects Selected");
    // x diverges (10 vs 20) → non-editable "—"; visible agrees (true) → an editable control.
    const rows = handle.el.querySelectorAll("[data-section-body] > *");
    expect(query(handle.el, "[data-section-body] [data-mixed]").textContent).toBe("—");
    expect(handle.el.querySelector("[data-field-key='visible']")).not.toBeNull();
    expect(rows.length).toBeGreaterThan(0);
  });

  it("rebuilds when the selection changes without an epoch bump", () => {
    const handle = mount();
    const entities = [
      entity({ id: 1, components: [transformOf(10, true)] }),
      entity({ id: 2, name: "Coin", components: [shapeOf()] })
    ];
    push(snap({ epoch: 1, entities, selection: [1] }));
    expect(query(handle.el, "[data-section][data-component='Transform']")).not.toBeNull();

    push(snap({ epoch: 1, entities, selection: [2] })); // same epoch, new selection

    expect(handle.el.querySelector("[data-section][data-component='Transform']")).toBeNull();
    expect(query(handle.el, "[data-section][data-component='Shape']")).not.toBeNull();
  });

  it("unsubscribes on unmount", () => {
    const handle = mount();
    expect(mocks.subscribers.size).toBe(1);

    handle.unmount();

    expect(mocks.subscribers.size).toBe(0);
  });
});

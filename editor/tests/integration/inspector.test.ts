// @vitest-environment happy-dom
import { mountIsland } from "@moku-labs/web/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { query } from "../helpers/dom";

// A controllable editor-host mock: controls come from the snapshot delivered via onSnapshot(); a field
// change routes through getEditor().bridge.setField. vi.hoisted so it precedes the vi.mock factory.
const mocks = vi.hoisted(() => {
  const subscribers = new Set<(snapshot: unknown) => void>();
  const bridge = {
    setField: vi.fn<(...args: unknown[]) => { ok: true } | { ok: false; error: string }>(() => ({
      ok: true
    }))
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

const { inspector } = await import("../../src/islands/inspector");

// A Transform component with an x number field + a visible boolean field.
const transform = (x: number, visible: boolean) => ({
  name: "Transform",
  value: { x, visible },
  fields: [
    { kind: "number", key: "x", label: "X" },
    { kind: "boolean", key: "visible", label: "Visible" }
  ]
});
const sprite = () => ({
  name: "Sprite",
  value: { tint: "#ff0000" },
  fields: [{ kind: "color", key: "tint", label: "Tint" }]
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

describe("inspector island", () => {
  it("leaves the field container empty when nothing is selected", () => {
    const handle = mountIsland(inspector, { html: "<div data-fields></div>" });

    push(
      snap({ epoch: 1, entities: [{ id: 1, components: [transform(10, true)] }], selection: [] })
    );

    expect(query(handle.el, "[data-fields]").children).toHaveLength(0);
  });

  it("renders a labelled control per field for the selected entity, seeded from its value", () => {
    const handle = mountIsland(inspector, { html: "<div data-fields></div>" });

    push(
      snap({ epoch: 1, entities: [{ id: 1, components: [transform(10, true)] }], selection: [1] })
    );

    expect(query(handle.el, "[data-component]").textContent).toBe("Transform");
    expect(query<HTMLInputElement>(handle.el, "[data-field-key='x']").value).toBe("10");
    expect(query<HTMLInputElement>(handle.el, "[data-field-key='visible']").checked).toBe(true);
  });

  it("routes a control change through bridge.setField(id, component, key, value)", () => {
    const handle = mountIsland(inspector, { html: "<div data-fields></div>" });
    push(
      snap({ epoch: 1, entities: [{ id: 1, components: [transform(10, true)] }], selection: [1] })
    );

    const x = query<HTMLInputElement>(handle.el, "[data-field-key='x']");
    x.value = "42";
    x.dispatchEvent(new Event("change", { bubbles: true }));

    expect(mocks.bridge.setField).toHaveBeenCalledWith(1, "Transform", "x", 42);
  });

  it("flags the control data-invalid with the reason when the write is rejected", () => {
    mocks.bridge.setField.mockReturnValueOnce({ ok: false, error: "out of range" });
    const handle = mountIsland(inspector, { html: "<div data-fields></div>" });
    push(
      snap({ epoch: 1, entities: [{ id: 1, components: [transform(10, true)] }], selection: [1] })
    );

    const x = query<HTMLInputElement>(handle.el, "[data-field-key='x']");
    x.value = "999";
    x.dispatchEvent(new Event("change", { bubbles: true }));

    expect(x.dataset.invalid).toBe("");
    expect(x.title).toBe("out of range");
  });

  it("rebuilds when the selection changes without an epoch bump", () => {
    const handle = mountIsland(inspector, { html: "<div data-fields></div>" });
    const entities = [
      { id: 1, components: [transform(10, true)] },
      { id: 2, components: [sprite()] }
    ];
    push(snap({ epoch: 1, entities, selection: [1] }));
    expect(query(handle.el, "[data-component]").textContent).toBe("Transform");

    push(snap({ epoch: 1, entities, selection: [2] })); // same epoch, new selection

    expect(query(handle.el, "[data-component]").textContent).toBe("Sprite");
  });

  it("unsubscribes on unmount", () => {
    const handle = mountIsland(inspector, { html: "<div data-fields></div>" });
    expect(mocks.subscribers.size).toBe(1);

    handle.unmount();

    expect(mocks.subscribers.size).toBe(0);
  });
});

/**
 * @file ui plugin — HUD + mutation API unit tests.
 *
 * Covers getWidget (top-level + panel-nested, stale/unknown), setText/setValue/
 * setVisible on live widgets, the clamp on setValue, removeHud (widget + its buttons),
 * and the guarded no-ops for stale / wrong-kind handles.
 */
import type { Text } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { createApi } from "../../api";
import type { State, WidgetView } from "../../types";
import { makeConfig, startedState } from "../helpers";

/** A ui API + its state, wired to a real root Container. */
const setup = () => {
  const config = makeConfig();
  const state = startedState(config);
  return { api: createApi({ config, state }), state };
};

/** Read a HUD widget's live view by handle id. */
const hudView = (state: State, id: number): WidgetView | undefined => state.hud.get(id);

describe("ui getWidget", () => {
  it("resolves a top-level and a panel-nested widget by id", () => {
    const { api } = setup();
    const screen = api.pushScreen({
      widgets: [
        { id: "title", kind: "label", text: "Paused" },
        {
          kind: "panel",
          width: 200,
          height: 120,
          children: [{ id: "resume", kind: "button", text: "Resume", onTap: vi.fn() }]
        }
      ]
    });

    expect(api.getWidget(screen, "title")).toBeDefined();
    expect(api.getWidget(screen, "resume")).toBeDefined();
    expect(api.getWidget(screen, "missing")).toBeUndefined();
  });

  it("returns undefined for a stale screen handle", () => {
    const { api } = setup();
    const screen = api.pushScreen({ widgets: [{ id: "x", kind: "label", text: "hi" }] });
    api.popScreen();
    expect(api.getWidget(screen, "x")).toBeUndefined();
  });
});

describe("ui mutation", () => {
  it("setText updates a HUD label's text node", () => {
    const { api, state } = setup();
    const handle = api.addHud({ kind: "label", text: "0" });

    api.setText(handle, "1200");

    expect((hudView(state, handle.id)?.text as Text).text).toBe("1200");
  });

  it("setText updates a screen widget resolved via getWidget", () => {
    const { api, state } = setup();
    const screen = api.pushScreen({ widgets: [{ id: "lbl", kind: "label", text: "a" }] });
    const handle = api.getWidget(screen, "lbl");
    if (!handle) throw new Error("expected a resolved widget handle");

    api.setText(handle, "b");

    expect((state.screens[0]?.widgets.get("lbl")?.text as Text).text).toBe("b");
  });

  it("setValue clamps to [0, max] and scales the bar fill", () => {
    const { api, state } = setup();
    const handle = api.addHud({ kind: "bar", value: 50, max: 100, width: 160, height: 12 });
    const bar = () => hudView(state, handle.id)?.bar;

    api.setValue(handle, 150); // over max → clamp to 100 (full)
    expect(bar()?.value).toBe(100);
    expect(bar()?.fill.scale.x).toBeCloseTo(1, 6);

    api.setValue(handle, -10); // under 0 → clamp to 0 (empty)
    expect(bar()?.value).toBe(0);
    expect(bar()?.fill.scale.x).toBeCloseTo(0, 6);

    api.setValue(handle, 40);
    expect(bar()?.fill.scale.x).toBeCloseTo(0.4, 6);
  });

  it("setVisible toggles the widget node's visibility", () => {
    const { api, state } = setup();
    const handle = api.addHud({ kind: "label", text: "hp" });

    api.setVisible(handle, false);
    expect(hudView(state, handle.id)?.node.visible).toBe(false);

    api.setVisible(handle, true);
    expect(hudView(state, handle.id)?.node.visible).toBe(true);
  });

  it("removeHud destroys the widget and drops its buttons from the hit-set", () => {
    const { api, state } = setup();
    const handle = api.addHud({
      kind: "button",
      text: "Pause",
      onTap: vi.fn(),
      width: 60,
      height: 30
    });

    expect(state.hudButtons.length).toBe(1);
    api.removeHud(handle);

    expect(state.hudButtons.length).toBe(0);
    expect(state.hud.size).toBe(0);
  });

  it("guards no-ops on stale / wrong-kind handles (leaves state unchanged)", () => {
    const { api, state } = setup();
    const label = api.addHud({ kind: "label", text: "x" });
    const bar = api.addHud({ kind: "bar", value: 1, max: 10, width: 100, height: 10 });

    // Wrong-kind: setValue on a label / setText on a bar leave the target untouched.
    api.setValue(label, 5);
    expect((hudView(state, label.id)?.text as Text).text).toBe("x");
    api.setText(bar, "nope");
    expect(hudView(state, bar.id)?.bar?.value).toBe(1);

    // Stale handles never throw and change nothing — both HUD widgets survive.
    expect(() => {
      api.setText({ kind: "widget", id: 9999 }, "x");
      api.setValue({ kind: "widget", id: 9999 }, 3);
      api.setVisible({ kind: "widget", id: 9999 }, false);
      api.removeHud({ kind: "widget", id: 9999 });
    }).not.toThrow();
    expect(state.hud.size).toBe(2);
  });
});

/**
 * @file ui plugin — screen-stack unit tests.
 *
 * Drives the screen-stack API against a state with a real root Container: push adds a
 * child + returns a distinct handle; pop/replace/clear destroy the removed
 * container(s); topScreen/screenCount track the stack.
 */
import { describe, expect, it, vi } from "vitest";
import { createApi } from "../../api";
import { makeConfig, startedState } from "../helpers";

/** A ui API + its state, wired to a real root Container. */
const setup = () => {
  const config = makeConfig();
  const state = startedState(config);
  return { api: createApi({ config, state }), state };
};

describe("ui screen stack", () => {
  it("pushScreen adds a child to the root and returns distinct handles", () => {
    const { api, state } = setup();

    const first = api.pushScreen({ widgets: [] });
    const second = api.pushScreen({ widgets: [] });

    expect(first.id).not.toBe(second.id);
    expect(state.root?.children.length).toBe(2);
    expect(api.screenCount()).toBe(2);
  });

  it("popScreen destroys the top container and decrements the count", () => {
    const { api, state } = setup();
    api.pushScreen({ widgets: [] });
    api.pushScreen({ widgets: [] });

    const top = state.screens.at(-1)?.container;
    if (!top) throw new Error("expected a top screen");
    const destroy = vi.spyOn(top, "destroy");

    api.popScreen();

    expect(destroy).toHaveBeenCalledOnce();
    expect(api.screenCount()).toBe(1);
  });

  it("popScreen is a no-op on an empty stack", () => {
    const { api } = setup();
    expect(() => api.popScreen()).not.toThrow();
    expect(api.screenCount()).toBe(0);
  });

  it("replaceScreen swaps the top screen (pop + push)", () => {
    const { api } = setup();
    const first = api.pushScreen({ widgets: [] });
    const replaced = api.replaceScreen({ widgets: [] });

    expect(api.screenCount()).toBe(1);
    expect(replaced.id).not.toBe(first.id);
    expect(api.topScreen()?.id).toBe(replaced.id);
  });

  it("clearScreens empties the stack and destroys every container", () => {
    const { api, state } = setup();
    api.pushScreen({ widgets: [] });
    api.pushScreen({ widgets: [] });
    const destroys = state.screens.map(s => vi.spyOn(s.container, "destroy"));

    api.clearScreens();

    expect(api.screenCount()).toBe(0);
    for (const destroy of destroys) expect(destroy).toHaveBeenCalledOnce();
  });

  it("topScreen tracks the top of the stack", () => {
    const { api } = setup();
    expect(api.topScreen()).toBeUndefined();

    const first = api.pushScreen({ widgets: [] });
    const second = api.pushScreen({ widgets: [] });
    expect(api.topScreen()?.id).toBe(second.id);

    api.popScreen();
    expect(api.topScreen()?.id).toBe(first.id);

    api.popScreen();
    expect(api.topScreen()).toBeUndefined();
  });

  it("a backdrop adds a full-viewport dimming rect as the first screen child", () => {
    const config = makeConfig({ width: 640, height: 480 });
    const state = startedState(config);
    const api = createApi({ config, state });

    api.pushScreen({ backdrop: { alpha: 0.5 }, widgets: [] });

    const container = state.screens[0]?.container;
    expect(container?.children.length).toBe(1);
    expect(container?.children[0]?.width).toBeCloseTo(640, 0);
  });
});

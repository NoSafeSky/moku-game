/**
 * @file ui plugin — headless-safety unit tests.
 *
 * With no renderer stage, onStart builds no root (but still registers the hit-test
 * system), and every API method is a safe no-op that returns a handle / undefined,
 * builds nothing, and never throws.
 */
import { describe, expect, it, vi } from "vitest";
import { inputPlugin } from "../../../input";
import { rendererPlugin } from "../../../renderer";
import { schedulerPlugin } from "../../../scheduler";
import { createApi } from "../../api";
import { type StartContext, start } from "../../lifecycle";
import { createState } from "../../state";
import { makeConfig } from "../helpers";

/** A no-op unsubscribe returned by the mock `addSystem`. */
const noop = (): void => {};

/** A StartContext whose renderer reports no stage (headless). */
const headlessStart = () => {
  const config = makeConfig();
  const state = createState({ global: {}, config });
  const addSystem = vi.fn();

  const require = ((plugin: unknown) => {
    if (plugin === rendererPlugin) return { getStage: () => undefined };
    if (plugin === schedulerPlugin) return { addSystem };
    if (plugin === inputPlugin)
      return { snapshot: () => ({ pointer: { x: 0, y: 0, buttons: 0 } }) };
    return undefined;
  }) as StartContext["require"];

  return { ctx: { state, require } satisfies StartContext, state, addSystem, config };
};

describe("ui headless", () => {
  it("onStart builds no root but still registers the hit-test system", () => {
    const { ctx, state, addSystem } = headlessStart();

    start(ctx);

    expect(state.root).toBeUndefined();
    expect(addSystem).toHaveBeenCalledWith("update", expect.any(Function));
  });

  it("every API method is a safe no-op with no root", () => {
    const { state, config } = headlessStart();
    const api = createApi({ config, state });

    expect(api.getRoot()).toBeUndefined();

    // Screen stack: returns a handle, builds nothing.
    const screen = api.pushScreen({ widgets: [{ kind: "label", text: "x" }] });
    expect(screen.kind).toBe("screen");
    expect(api.screenCount()).toBe(0);
    expect(api.topScreen()).toBeUndefined();

    // HUD: returns a handle, builds nothing.
    const hud = api.addHud({ kind: "bar", value: 1, max: 10, width: 100, height: 10 });
    expect(hud.kind).toBe("widget");
    expect(state.hud.size).toBe(0);

    // Mutations + teardown never throw.
    expect(() => {
      api.setText(hud, "y");
      api.setValue(hud, 5);
      api.setVisible(hud, false);
      api.removeHud(hud);
      api.popScreen();
      api.replaceScreen({ widgets: [] });
      api.clearScreens();
    }).not.toThrow();
    expect(api.getWidget(screen, "x")).toBeUndefined();
  });

  it("the registered hit-test system never reads input when headless", () => {
    const config = makeConfig();
    const state = createState({ global: {}, config });
    const snapshot = vi.fn(() => ({ pointer: { x: 0, y: 0, buttons: 0 } }));
    let registered: ((world: never, dt: number) => void) | undefined;

    const require = ((plugin: unknown) => {
      if (plugin === rendererPlugin) return { getStage: () => undefined };
      if (plugin === schedulerPlugin) {
        return {
          addSystem: (_stage: string, system: (world: never, dt: number) => void) => {
            registered = system;
            return noop;
          }
        };
      }
      return { snapshot };
    }) as StartContext["require"];

    start({ state, require });

    expect(state.root).toBeUndefined();
    expect(registered).toBeDefined();
    registered?.({} as never, 1 / 60); // run the system — it must guard on the missing root
    expect(snapshot).not.toHaveBeenCalled();
  });
});

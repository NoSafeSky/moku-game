/**
 * @file ui plugin — pointer hit-test system unit tests.
 *
 * Drives the update-stage system with a scripted pointer and a real button rect:
 * press/release edges (fire only on release over the armed button), rapid taps,
 * hover toggling, modal capture (screen vs HUD), and the headless no-op.
 */
import { describe, expect, it, vi } from "vitest";
import { createApi } from "../../api";
import { createHitTestSystem } from "../../system";
import type { State } from "../../types";
import { makeConfig, makeInput, startedState } from "../helpers";

/** No world/dt matter to the hit-test system. */
const NO_WORLD = {} as never;

/** A screen with one 80×40 button centered at (100,100); returns the tap spy + state. */
const withButton = () => {
  const config = makeConfig();
  const state = startedState(config);
  const api = createApi({ config, state });
  const onTap = vi.fn();
  api.pushScreen({
    widgets: [{ kind: "button", text: "Go", onTap, x: 100, y: 100, width: 80, height: 40 }]
  });
  return { state, onTap };
};

/** Run the system after moving/pressing the pointer. */
const drive = (
  system: (w: never, dt: number) => void,
  pointer: { x: number; y: number; buttons: number },
  next: { x?: number; y?: number; buttons: number }
): void => {
  if (next.x !== undefined) pointer.x = next.x;
  if (next.y !== undefined) pointer.y = next.y;
  pointer.buttons = next.buttons;
  system(NO_WORLD, 1 / 60);
};

describe("ui hit-test system", () => {
  it("fires onTap once on press-inside then release-inside", () => {
    const { state, onTap } = withButton();
    const { input, pointer } = makeInput();
    const system = createHitTestSystem({ input, state });

    drive(system, pointer, { x: 0, y: 0, buttons: 0 }); // up, outside
    drive(system, pointer, { x: 100, y: 100, buttons: 1 }); // down, inside → arm
    drive(system, pointer, { buttons: 0 }); // up, inside → fire

    expect(onTap).toHaveBeenCalledOnce();
  });

  it("does not fire when released outside the armed button", () => {
    const { state, onTap } = withButton();
    const { input, pointer } = makeInput();
    const system = createHitTestSystem({ input, state });

    drive(system, pointer, { x: 100, y: 100, buttons: 1 }); // down, inside → arm
    drive(system, pointer, { x: 400, y: 400, buttons: 0 }); // up, outside → no fire

    expect(onTap).not.toHaveBeenCalled();
  });

  it("does not fire when armed outside then released inside", () => {
    const { state, onTap } = withButton();
    const { input, pointer } = makeInput();
    const system = createHitTestSystem({ input, state });

    drive(system, pointer, { x: 400, y: 400, buttons: 1 }); // down, outside → arm nothing
    drive(system, pointer, { x: 100, y: 100, buttons: 0 }); // up, inside → no fire

    expect(onTap).not.toHaveBeenCalled();
  });

  it("fires twice for two rapid taps", () => {
    const { state, onTap } = withButton();
    const { input, pointer } = makeInput();
    const system = createHitTestSystem({ input, state });

    drive(system, pointer, { x: 100, y: 100, buttons: 1 });
    drive(system, pointer, { buttons: 0 });
    drive(system, pointer, { buttons: 1 });
    drive(system, pointer, { buttons: 0 });

    expect(onTap).toHaveBeenCalledTimes(2);
  });

  it("toggles hovered as the pointer enters and leaves", () => {
    const { state } = withButton();
    const button = (state.screens[0] as State["screens"][number]).buttons[0];
    const { input, pointer } = makeInput();
    const system = createHitTestSystem({ input, state });

    drive(system, pointer, { x: 100, y: 100, buttons: 0 });
    expect(button?.hovered).toBe(true);

    drive(system, pointer, { x: 400, y: 400, buttons: 0 });
    expect(button?.hovered).toBe(false);
  });

  it("captures input to the top screen — HUD buttons are inert while a screen is up", () => {
    const config = makeConfig();
    const state = startedState(config);
    const api = createApi({ config, state });

    const hudTap = vi.fn();
    api.addHud({
      kind: "button",
      text: "Pause",
      onTap: hudTap,
      x: 700,
      y: 20,
      width: 60,
      height: 30
    });
    const screenTap = vi.fn();
    api.pushScreen({
      widgets: [
        { kind: "button", text: "Resume", onTap: screenTap, x: 100, y: 100, width: 80, height: 40 }
      ]
    });

    const { input, pointer } = makeInput();
    const system = createHitTestSystem({ input, state });

    // Tap over the HUD button's rect while the modal screen is up → inert.
    drive(system, pointer, { x: 700, y: 20, buttons: 1 });
    drive(system, pointer, { buttons: 0 });
    expect(hudTap).not.toHaveBeenCalled();

    // Once the stack is empty, the HUD button taps normally.
    api.clearScreens();
    drive(system, pointer, { x: 700, y: 20, buttons: 1 });
    drive(system, pointer, { buttons: 0 });
    expect(hudTap).toHaveBeenCalledOnce();
  });

  it("is a no-op (never reads input) when headless", () => {
    const config = makeConfig();
    const state = startedState(config);
    state.root = undefined; // headless
    const snapshot = vi.fn(() => ({ pointer: { x: 0, y: 0, buttons: 0 } }));
    const system = createHitTestSystem({ input: { snapshot }, state });

    expect(() => system(NO_WORLD, 1 / 60)).not.toThrow();
    expect(snapshot).not.toHaveBeenCalled();
  });
});

/**
 * @file camera plugin — editor-control system unit tests (Phase-1 F2).
 *
 * Drives `createEditorControlSystem` with a fake `InputApi` (a stub `snapshot()`
 * returning scripted `wheel` / `pointer` / `isDown`) and a hand-built `State` + `Config`
 * — no kernel. Covers: wheel.deltaY triggers a cursor-anchored zoom; holding the middle
 * button (`buttons & 4`) or space (`isDown(" ")`) across two frames pans by the pointer
 * delta; releasing then re-pressing starts a fresh drag with no jump; and a frame with
 * no wheel + no pan mutates nothing.
 */
import { describe, expect, it } from "vitest";
import type { Api as InputApi, InputSnapshot } from "../../../input/types";
import type { World } from "../../../scheduler/types";
import { createEditorControlSystem } from "../../editor-controls";
import type { Config, State } from "../../types";

const makeConfig = (over: Partial<Config> = {}): Config => ({
  zoom: 1,
  minZoom: 0.1,
  maxZoom: 10,
  followLerp: 0.15,
  width: 800,
  height: 600,
  updateStage: "sync",
  editorControls: true,
  ...over
});

const makeState = (over: Partial<State> = {}): State => ({
  started: true,
  stage: undefined,
  layers: new Map(),
  center: { x: 0, y: 0 },
  follow: undefined,
  zoom: 1,
  rotation: 0,
  shakeIntensity: 0,
  shakeHandle: undefined,
  tween: undefined,
  input: undefined,
  ...over
});

/** The system never touches `world`; a dummy satisfies the `System` signature. */
const world = {} as World;

/** A scriptable fake `InputApi` whose `snapshot()` returns whatever `setFrame` last set. */
const makeFakeInput = () => {
  let frame: InputSnapshot = {
    isDown: () => false,
    justPressed: () => false,
    justReleased: () => false,
    pointer: { x: 0, y: 0, buttons: 0 },
    wheel: { deltaX: 0, deltaY: 0 }
  };

  const setFrame = (
    next: Partial<InputSnapshot> & {
      pointer?: Partial<InputSnapshot["pointer"]>;
      wheel?: Partial<InputSnapshot["wheel"]>;
    }
  ): void => {
    frame = {
      ...frame,
      ...next,
      pointer: { ...frame.pointer, ...next.pointer },
      wheel: { ...frame.wheel, ...next.wheel }
    };
  };

  const input: InputApi = {
    snapshot: () => frame,
    keyDown: () => undefined,
    keyUp: () => undefined,
    keyPress: () => undefined
  };

  return { input, setFrame };
};

describe("createEditorControlSystem — wheel zoom", () => {
  it("zooms cursor-anchored when wheel.deltaY !== 0", () => {
    const state = makeState({ zoom: 1 });
    const config = makeConfig();
    const { input, setFrame } = makeFakeInput();
    const system = createEditorControlSystem({ state, config, input });

    setFrame({ pointer: { x: 400, y: 300, buttons: 0 }, wheel: { deltaX: 0, deltaY: -100 } });
    system(world, 1 / 60);

    expect(state.zoom).toBeGreaterThan(1); // scroll up (negative deltaY) → zoom in
  });

  it("zooms out on a positive deltaY", () => {
    const state = makeState({ zoom: 1 });
    const config = makeConfig();
    const { input, setFrame } = makeFakeInput();
    const system = createEditorControlSystem({ state, config, input });

    setFrame({ pointer: { x: 400, y: 300, buttons: 0 }, wheel: { deltaX: 0, deltaY: 100 } });
    system(world, 1 / 60);

    expect(state.zoom).toBeLessThan(1);
  });

  it("does nothing on a frame with no wheel motion and no pan", () => {
    const state = makeState({ center: { x: 5, y: 5 }, zoom: 2 });
    const config = makeConfig();
    const { input, setFrame } = makeFakeInput();
    const system = createEditorControlSystem({ state, config, input });

    setFrame({ pointer: { x: 400, y: 300, buttons: 0 }, wheel: { deltaX: 0, deltaY: 0 } });
    system(world, 1 / 60);

    expect(state.center).toEqual({ x: 5, y: 5 });
    expect(state.zoom).toBe(2);
  });
});

describe("createEditorControlSystem — drag pan", () => {
  it("pans by the pointer delta across two frames while the middle button is held", () => {
    const state = makeState({ center: { x: 0, y: 0 } });
    const config = makeConfig();
    const { input, setFrame } = makeFakeInput();
    const system = createEditorControlSystem({ state, config, input });

    setFrame({ pointer: { x: 400, y: 300, buttons: 4 } }); // first held frame — no lastPointer yet
    system(world, 1 / 60);
    expect(state.center).toEqual({ x: 0, y: 0 });

    setFrame({ pointer: { x: 420, y: 290, buttons: 4 } }); // moved +20 / -10
    system(world, 1 / 60);
    expect(state.center.x).toBeCloseTo(-20, 6);
    expect(state.center.y).toBeCloseTo(10, 6);
  });

  it("pans while space is held, even with no pointer button", () => {
    const state = makeState({ center: { x: 0, y: 0 } });
    const config = makeConfig();
    const { input, setFrame } = makeFakeInput();
    const system = createEditorControlSystem({ state, config, input });

    setFrame({ pointer: { x: 100, y: 100, buttons: 0 }, isDown: key => key === " " });
    system(world, 1 / 60);

    setFrame({ pointer: { x: 110, y: 105, buttons: 0 }, isDown: key => key === " " });
    system(world, 1 / 60);

    expect(state.center.x).toBeCloseTo(-10, 6);
    expect(state.center.y).toBeCloseTo(-5, 6);
  });

  it("releasing then re-pressing starts a fresh drag with no jump", () => {
    const state = makeState({ center: { x: 0, y: 0 } });
    const config = makeConfig();
    const { input, setFrame } = makeFakeInput();
    const system = createEditorControlSystem({ state, config, input });

    setFrame({ pointer: { x: 0, y: 0, buttons: 4 } });
    system(world, 1 / 60);
    setFrame({ pointer: { x: 50, y: 0, buttons: 4 } });
    system(world, 1 / 60);
    expect(state.center.x).toBeCloseTo(-50, 6);

    setFrame({ pointer: { x: 200, y: 0, buttons: 0 } }); // release
    system(world, 1 / 60);
    expect(state.center.x).toBeCloseTo(-50, 6); // unchanged while released

    setFrame({ pointer: { x: 200, y: 0, buttons: 4 } }); // re-press far away
    system(world, 1 / 60);
    expect(state.center.x).toBeCloseTo(-50, 6); // first frame of the new drag — no jump

    setFrame({ pointer: { x: 210, y: 0, buttons: 4 } });
    system(world, 1 / 60);
    expect(state.center.x).toBeCloseTo(-60, 6); // only the fresh 10px delta applied
  });
});

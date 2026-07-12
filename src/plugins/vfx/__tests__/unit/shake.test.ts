/**
 * @file vfx plugin — screen-shake system unit tests.
 *
 * Drives the render-stage shake system directly (no Pixi): trauma² offset,
 * per-frame decay, snap-back to (0,0) at zero, and the headless path. The
 * `shake()` / `stopShake()` API surface is covered in `api.test.ts`.
 */
import type { Container } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { createState } from "../../state";
import { createShakeSystem } from "../../systems/shake";
import { makeConfig, makeRenderer } from "../helpers";

/** A stage whose `position.set` spy is directly inspectable. */
const spyStage = () => {
  const set = vi.fn();
  const stage = { position: { set } } as unknown as Container;
  return { stage, set };
};

describe("shake system", () => {
  it("offsets the stage by trauma² · shakeMaxOffset in a random direction", () => {
    const config = makeConfig({ shakeMaxOffset: 24, shakeDecay: 1.8 });
    const state = createState({ global: {}, config });
    state.trauma = 1; // trauma² = 1 → full offset
    const { stage, set } = spyStage();

    const shake = createShakeSystem({
      renderer: makeRenderer(stage),
      config,
      state,
      random: () => 1 // (1*2 - 1) = +1 → +shakeMaxOffset
    });

    shake({} as never, 0.001); // tiny dt → does not decay to zero

    expect(set).toHaveBeenCalledWith(24, 24);
  });

  it("decays trauma by shakeDecay · dt each frame", () => {
    const config = makeConfig({ shakeDecay: 1.8 });
    const state = createState({ global: {}, config });
    state.trauma = 0.5;
    const { stage } = spyStage();

    const shake = createShakeSystem({
      renderer: makeRenderer(stage),
      config,
      state,
      random: () => 0.5
    });
    shake({} as never, 0.1);

    expect(state.trauma).toBeCloseTo(0.5 - 1.8 * 0.1, 6); // 0.32
  });

  it("snaps the stage back to (0,0) the frame trauma reaches zero", () => {
    const config = makeConfig({ shakeDecay: 1.8 });
    const state = createState({ global: {}, config });
    state.trauma = 0.1;
    const { stage, set } = spyStage();

    const shake = createShakeSystem({
      renderer: makeRenderer(stage),
      config,
      state,
      random: () => 1
    });
    shake({} as never, 1); // huge dt → trauma clamps to 0

    expect(state.trauma).toBe(0);
    expect(set).toHaveBeenLastCalledWith(0, 0);
  });

  it("is a no-op at rest (trauma already 0)", () => {
    const config = makeConfig();
    const state = createState({ global: {}, config });
    state.trauma = 0;
    const { stage, set } = spyStage();

    const shake = createShakeSystem({
      renderer: makeRenderer(stage),
      config,
      state,
      random: () => 1
    });
    shake({} as never, 0.016);

    expect(set).not.toHaveBeenCalled();
  });

  it("decays without throwing when headless (no stage)", () => {
    const config = makeConfig({ shakeDecay: 1.8 });
    const state = createState({ global: {}, config });
    state.trauma = 0.5;

    const shake = createShakeSystem({
      renderer: makeRenderer(undefined), // headless — getStage() → undefined
      config,
      state,
      random: () => 1
    });

    expect(() => shake({} as never, 0.1)).not.toThrow();
    expect(state.trauma).toBeCloseTo(0.32, 6);
  });
});

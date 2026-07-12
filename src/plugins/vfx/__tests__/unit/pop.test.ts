/**
 * @file vfx plugin — scale-pop system unit tests.
 *
 * Drives the pop system against a real world + mock renderer: the base → apex →
 * base pulse, `markDirty` each frame, and end-of-life restoration of the EXACT
 * captured base scale plus `Pop` removal. The `pop()` API (base capture, refresh,
 * no-Transform guard) is covered in `api.test.ts`.
 */
import { describe, expect, it } from "vitest";
import type { Entity } from "../../../ecs/types";
import { createPopSystem } from "../../systems/pop";
import { makeRenderer, makeStage, setup } from "../helpers";

/** Spawn a Transform entity at the given base scale and give it a Pop. */
const popped = (
  s: ReturnType<typeof setup>,
  base: number,
  pop: { duration: number; amplitude: number }
): Entity => {
  const entity = s.world.spawn(
    s.transform({ x: 0, y: 0, rotation: 0, scaleX: base, scaleY: base })
  );
  s.world.add(entity, s.Pop, {
    age: 0,
    duration: pop.duration,
    amplitude: pop.amplitude,
    baseScaleX: base,
    baseScaleY: base
  });
  return entity;
};

describe("pop system", () => {
  it("pulses the scale up to amplitude× at the apex", () => {
    const s = setup();
    const renderer = makeRenderer(makeStage());
    const entity = popped(s, 2, { duration: 0.2, amplitude: 1.5 });

    const pop = createPopSystem({ world: s.world, transform: s.transform, Pop: s.Pop, renderer });
    pop(s.world, 0.1); // progress 0.5 → sin(π/2) = 1 → apex

    const tf = s.world.get(entity, s.transform);
    expect(tf?.scaleX).toBeCloseTo(3, 6); // base 2 × amplitude 1.5
    expect(tf?.scaleY).toBeCloseTo(3, 6);
    expect(renderer.markDirty).toHaveBeenCalledWith(entity);
  });

  it("stays between base and apex mid-pulse", () => {
    const s = setup();
    const entity = popped(s, 1, { duration: 0.2, amplitude: 2 });

    const pop = createPopSystem({
      world: s.world,
      transform: s.transform,
      Pop: s.Pop,
      renderer: makeRenderer(makeStage())
    });
    pop(s.world, 0.05); // progress 0.25 → partway up

    const scale = s.world.get(entity, s.transform)?.scaleX ?? 0;
    expect(scale).toBeGreaterThan(1);
    expect(scale).toBeLessThan(2);
  });

  it("restores the exact base scale and removes the Pop at end of life", () => {
    const s = setup();
    const entity = popped(s, 2, { duration: 0.2, amplitude: 1.5 });

    const pop = createPopSystem({
      world: s.world,
      transform: s.transform,
      Pop: s.Pop,
      renderer: makeRenderer(makeStage())
    });
    pop(s.world, 0.2); // age 0.2 ≥ duration 0.2 → restore + remove

    const tf = s.world.get(entity, s.transform);
    expect(tf?.scaleX).toBe(2);
    expect(tf?.scaleY).toBe(2);
    expect(s.world.has(entity, s.Pop)).toBe(false);
  });
});

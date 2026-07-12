/**
 * @file vfx plugin — floating-text system unit tests.
 *
 * Drives the floating system against a real world + a fake retained Text handle:
 * upward rise (Transform.y decreases), alpha lerp on the handle, `markDirty`, and
 * end-of-life despawn + handle drop. Also the headless path (no handle → no alpha
 * write, still despawns).
 */
import type { Container } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { Entity } from "../../../ecs/types";
import { createFloatingSystem } from "../../systems/floating";
import { makeRenderer, makeStage, setup } from "../helpers";

/** Spawn a floating-text entity at (x, y) with the given runtime values. */
const floating = (
  s: ReturnType<typeof setup>,
  y: number,
  value: { lifetime: number; riseSpeed: number; startAlpha: number; endAlpha: number }
): Entity =>
  s.world.spawn(
    s.FloatingText({ age: 0, ...value }),
    s.transform({ x: 0, y, rotation: 0, scaleX: 1, scaleY: 1 })
  );

describe("floating-text system", () => {
  it("rises (Transform.y decreases) and fades the retained Text handle", () => {
    const s = setup();
    const renderer = makeRenderer(makeStage());
    const entity = floating(s, 100, { lifetime: 1, riseSpeed: 40, startAlpha: 1, endAlpha: 0 });

    const text = { alpha: 1 } as unknown as Container;
    s.state.views.set(entity, text);

    const system = createFloatingSystem({
      world: s.world,
      transform: s.transform,
      FloatingText: s.FloatingText,
      renderer,
      state: s.state
    });
    system(s.world, 0.5);

    expect(s.world.get(entity, s.transform)?.y).toBeCloseTo(80, 6); // 100 - 40*0.5 (upward)
    expect((text as unknown as { alpha: number }).alpha).toBeCloseTo(0.5, 6); // lerp(1,0,0.5)
    expect(renderer.markDirty).toHaveBeenCalledWith(entity);
  });

  it("despawns and drops the handle at end of life", () => {
    const s = setup();
    const entity = floating(s, 100, { lifetime: 1, riseSpeed: 40, startAlpha: 1, endAlpha: 0 });
    s.state.views.set(entity, { alpha: 1 } as unknown as Container);

    const system = createFloatingSystem({
      world: s.world,
      transform: s.transform,
      FloatingText: s.FloatingText,
      renderer: makeRenderer(makeStage()),
      state: s.state
    });
    system(s.world, 1); // age 1 ≥ lifetime 1 → despawn

    expect(s.world.query(s.FloatingText).count()).toBe(0);
    expect(s.state.views.has(entity)).toBe(false);
  });

  it("simulates without a Text handle when headless (no throw)", () => {
    const s = setup();
    const entity = floating(s, 100, { lifetime: 1, riseSpeed: 40, startAlpha: 1, endAlpha: 0 });
    // No handle stored → headless path.

    const system = createFloatingSystem({
      world: s.world,
      transform: s.transform,
      FloatingText: s.FloatingText,
      renderer: makeRenderer(undefined),
      state: s.state
    });

    expect(() => system(s.world, 0.5)).not.toThrow();
    expect(s.world.get(entity, s.transform)?.y).toBeCloseTo(80, 6);
  });
});

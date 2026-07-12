/**
 * @file vfx plugin — easing + lerp unit tests.
 *
 * Every curve must map f(0)=0, f(1)=1 and stay finite on [0,1]; lerp is the
 * standard linear interpolation.
 */
import { describe, expect, it } from "vitest";
import { easing, lerp } from "../../easing";
import type { EasingName } from "../../types";

const NAMES: EasingName[] = [
  "linear",
  "easeInQuad",
  "easeOutQuad",
  "easeInOutQuad",
  "easeOutCubic",
  "easeOutBack",
  "easeOutElastic"
];

describe("easing curves", () => {
  it("exposes exactly the seven named curves", () => {
    expect(Object.keys(easing).toSorted()).toEqual([...NAMES].toSorted());
  });

  for (const name of NAMES) {
    describe(name, () => {
      const f = easing[name];

      it("maps f(0) = 0", () => {
        expect(f(0)).toBeCloseTo(0, 6);
      });

      it("maps f(1) = 1", () => {
        expect(f(1)).toBeCloseTo(1, 6);
      });

      it("is finite across [0, 1]", () => {
        for (let t = 0; t <= 1; t += 0.1) {
          expect(Number.isFinite(f(t))).toBe(true);
        }
      });
    });
  }

  it("linear is the identity", () => {
    expect(easing.linear(0.25)).toBe(0.25);
    expect(easing.linear(0.9)).toBe(0.9);
  });

  it("easeInQuad and easeOutQuad are complementary at the midpoint", () => {
    expect(easing.easeInQuad(0.5)).toBeCloseTo(0.25, 6);
    expect(easing.easeOutQuad(0.5)).toBeCloseTo(0.75, 6);
  });

  it("easeOutBack overshoots past 1 before settling", () => {
    // Somewhere in the back half the curve exceeds 1 (the springy overshoot).
    const peak = Math.max(...[0.6, 0.7, 0.8].map(t => easing.easeOutBack(t)));
    expect(peak).toBeGreaterThan(1);
  });
});

describe("lerp", () => {
  it("returns a at t = 0 and b at t = 1", () => {
    expect(lerp(3, 9, 0)).toBe(3);
    expect(lerp(3, 9, 1)).toBe(9);
  });

  it("interpolates the midpoint", () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
  });

  it("extrapolates past the endpoints (unclamped)", () => {
    expect(lerp(0, 10, 2)).toBe(20);
  });

  it("is exposed on the frozen easing table by name", () => {
    // @ts-expect-error — "bogus" is not an EasingName.
    expect(easing.bogus).toBeUndefined();
  });
});

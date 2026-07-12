/**
 * @file tween plugin — easing + lerp unit tests.
 *
 * Every curve must map f(0)=0, f(1)=1 and stay finite on [0,1]; lerp is the
 * standard (unclamped) linear interpolation. Mirrors vfx's easing suite so the
 * two tables stay in lock-step (the eventual dedupe is a drop-in).
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

  it("easeOutBack overshoots past 1 before settling", () => {
    const peak = Math.max(...[0.6, 0.7, 0.8].map(t => easing.easeOutBack(t)));
    expect(peak).toBeGreaterThan(1);
  });

  it("easeOutElastic endpoints are exact", () => {
    expect(easing.easeOutElastic(0)).toBe(0);
    expect(easing.easeOutElastic(1)).toBe(1);
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
});

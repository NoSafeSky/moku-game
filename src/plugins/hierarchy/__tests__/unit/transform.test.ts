/**
 * @file hierarchy plugin — unit tests for the pure 2D affine transform math (`transform.ts`).
 */
import { describe, expect, it } from "vitest";
import { compose, IDENTITY, invert } from "../../transform";

describe("hierarchy — transform", () => {
  it("compose(IDENTITY, t) returns t unchanged", () => {
    const t = { x: 3, y: -4, rotation: 0.5, scaleX: 2, scaleY: 3 };
    expect(compose(IDENTITY, t)).toEqual(t);
  });

  it("compose matches a hand-computed 2D TRS for a translate+rotate+scale parent", () => {
    const parent = { x: 10, y: 5, rotation: Math.PI / 2, scaleX: 2, scaleY: 2 };
    const local = { x: 1, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };

    const world = compose(parent, local);

    expect(world.x).toBeCloseTo(10);
    expect(world.y).toBeCloseTo(7);
    expect(world.rotation).toBeCloseTo(Math.PI / 2);
    expect(world.scaleX).toBeCloseTo(2);
    expect(world.scaleY).toBeCloseTo(2);
  });

  it("invert(t) round-trips: compose(invert(t), t) ≈ IDENTITY", () => {
    const t = { x: 12, y: -7, rotation: 0.9, scaleX: 1.5, scaleY: 0.5 };

    const result = compose(invert(t), t);

    expect(result.x).toBeCloseTo(IDENTITY.x);
    expect(result.y).toBeCloseTo(IDENTITY.y);
    expect(result.rotation).toBeCloseTo(IDENTITY.rotation);
    expect(result.scaleX).toBeCloseTo(IDENTITY.scaleX);
    expect(result.scaleY).toBeCloseTo(IDENTITY.scaleY);
  });

  it("invert of a scale-0 transform does not divide by zero", () => {
    const degenerate = { x: 5, y: 5, rotation: 0, scaleX: 0, scaleY: 0 };

    const inverse = invert(degenerate);

    expect(Number.isFinite(inverse.x)).toBe(true);
    expect(Number.isFinite(inverse.y)).toBe(true);
    expect(inverse.scaleX).toBe(0);
    expect(inverse.scaleY).toBe(0);
  });
});

/**
 * @file camera plugin — coordinate-math unit tests.
 *
 * Pure `screenToWorld` / `worldToScreen` over plain numbers (no Pixi): the centre maps
 * to the viewport centre; a pure pan offsets linearly; zoom scales distance from the
 * centre; rotation rotates about the centre; and the two are exact inverses
 * (round-trip within an epsilon) across zoom + rotation + pan combinations.
 */
import { describe, expect, it } from "vitest";
import { screenToWorld, worldToScreen } from "../../transform";
import type { Point } from "../../types";

const W = 800;
const H = 600;
const CENTRE_SCREEN: Point = { x: W / 2, y: H / 2 };

describe("worldToScreen", () => {
  it("maps the camera centre to the viewport centre (identity zoom/rotation)", () => {
    const p = worldToScreen({ x: 100, y: 50 }, { x: 100, y: 50 }, 1, 0, W, H);
    expect(p.x).toBeCloseTo(CENTRE_SCREEN.x, 6);
    expect(p.y).toBeCloseTo(CENTRE_SCREEN.y, 6);
  });

  it("offsets linearly for a pure pan (no zoom/rotation)", () => {
    // A world point 10 right / 20 up of the centre lands 10/20 from the screen centre.
    const p = worldToScreen({ x: 10, y: 20 }, { x: 0, y: 0 }, 1, 0, W, H);
    expect(p.x).toBeCloseTo(CENTRE_SCREEN.x + 10, 6);
    expect(p.y).toBeCloseTo(CENTRE_SCREEN.y + 20, 6);
  });

  it("scales distance from the centre by zoom", () => {
    const p = worldToScreen({ x: 10, y: 0 }, { x: 0, y: 0 }, 2, 0, W, H);
    expect(p.x).toBeCloseTo(CENTRE_SCREEN.x + 20, 6); // 10 * zoom 2
    expect(p.y).toBeCloseTo(CENTRE_SCREEN.y, 6);
  });

  it("rotates about the centre", () => {
    // +90° rotation sends (+x) world offset to (+y) screen offset.
    const p = worldToScreen({ x: 10, y: 0 }, { x: 0, y: 0 }, 1, Math.PI / 2, W, H);
    expect(p.x).toBeCloseTo(CENTRE_SCREEN.x, 6);
    expect(p.y).toBeCloseTo(CENTRE_SCREEN.y + 10, 6);
  });
});

describe("screenToWorld", () => {
  it("maps the viewport centre to the camera centre", () => {
    const p = screenToWorld(CENTRE_SCREEN, { x: 100, y: 50 }, 1, 0, W, H);
    expect(p.x).toBeCloseTo(100, 6);
    expect(p.y).toBeCloseTo(50, 6);
  });
});

describe("round-trip screenToWorld(worldToScreen(p)) ≈ p", () => {
  const cases: ReadonlyArray<{
    name: string;
    center: Point;
    zoom: number;
    rotation: number;
  }> = [
    { name: "identity", center: { x: 0, y: 0 }, zoom: 1, rotation: 0 },
    { name: "pan", center: { x: 320, y: -180 }, zoom: 1, rotation: 0 },
    { name: "zoom", center: { x: 0, y: 0 }, zoom: 2.5, rotation: 0 },
    { name: "rotation", center: { x: 0, y: 0 }, zoom: 1, rotation: 0.7 },
    { name: "pan+zoom+rotation", center: { x: -50, y: 75 }, zoom: 1.8, rotation: -1.2 }
  ];

  for (const { name, center, zoom, rotation } of cases) {
    it(`is an exact inverse — ${name}`, () => {
      const world: Point = { x: 123.4, y: -56.7 };
      const screen = worldToScreen(world, center, zoom, rotation, W, H);
      const back = screenToWorld(screen, center, zoom, rotation, W, H);
      expect(back.x).toBeCloseTo(world.x, 6);
      expect(back.y).toBeCloseTo(world.y, 6);
    });
  }
});

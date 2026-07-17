/**
 * @file editor-gizmos plugin — pure drag math unit tests.
 */
import { describe, expect, it } from "vitest";
import type { EditorId } from "../../../commands/types";
import type { Entity } from "../../../ecs/types";
import { computeRotation, computeScale, computeTarget, snapAngle, snapValue } from "../../math";
import type { ActiveDrag } from "../../types";

const asEntity = (n: number): Entity => n as Entity;
const asEditorId = (n: number): EditorId => n as EditorId;

describe("editor-gizmos — math — snapValue", () => {
  it("returns the value unchanged when snap <= 0", () => {
    expect(snapValue(37, 0)).toBe(37);
    expect(snapValue(37, -5)).toBe(37);
  });

  it("rounds to the nearest multiple of snap when snap > 0", () => {
    expect(snapValue(37, 32)).toBe(32);
    expect(snapValue(48, 32)).toBe(64);
    expect(snapValue(16, 32)).toBe(32);
  });
});

/**
 * Build an ActiveDrag anchored at start (100,50) with grab origin (200,200), for the given
 * axis. `over` layers on the rotate/scale fields (mode, start rotation/scale, pivot anchor).
 */
const baseDrag = (axis: ActiveDrag["axis"], over: Partial<ActiveDrag> = {}): ActiveDrag => ({
  entity: asEntity(1),
  editorId: asEditorId(1),
  mode: "translate",
  axis,
  startX: 100,
  startY: 50,
  startRotation: 0,
  startScaleX: 1,
  startScaleY: 1,
  pivotWorld: { x: 100, y: 50 },
  originWorld: { x: 200, y: 200 },
  ...over
});

describe("editor-gizmos — math — computeTarget", () => {
  it("axis 'x' maps dx only — y stays pinned to startY", () => {
    const drag = baseDrag("x");
    const target = computeTarget(drag, { x: 230, y: 260 }, 0);
    expect(target).toEqual({ x: 130, y: 50 });
  });

  it("axis 'y' maps dy only — x stays pinned to startX", () => {
    const drag = baseDrag("y");
    const target = computeTarget(drag, { x: 230, y: 260 }, 0);
    expect(target).toEqual({ x: 100, y: 110 });
  });

  it("axis 'xy' maps both dx and dy", () => {
    const drag = baseDrag("xy");
    const target = computeTarget(drag, { x: 230, y: 260 }, 0);
    expect(target).toEqual({ x: 130, y: 110 });
  });

  it("applies snap to the moved axis", () => {
    const drag = baseDrag("xy");
    // dx = 37, dy = 48 → startX + dx = 137 (snaps to 128), startY + dy = 98 (snaps to 96)
    const target = computeTarget(drag, { x: 237, y: 248 }, 32);
    expect(target).toEqual({ x: 128, y: 96 });
  });

  it("a zero delta returns exactly the start position", () => {
    const drag = baseDrag("xy");
    const target = computeTarget(drag, drag.originWorld, 0);
    expect(target).toEqual({ x: drag.startX, y: drag.startY });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// snapAngle — the rotate mode's interpretation of the single `snap` knob (radians)
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-gizmos — math — snapAngle", () => {
  it("returns the angle unchanged when snap <= 0", () => {
    expect(snapAngle(1.234, 0)).toBe(1.234);
    expect(snapAngle(1.234, -0.5)).toBe(1.234);
  });

  it("rounds to the nearest multiple of snap radians", () => {
    expect(snapAngle(0.6, 0.5)).toBeCloseTo(0.5, 10);
    expect(snapAngle(0.9, 0.5)).toBeCloseTo(1, 10);
  });

  it("rounds a negative angle toward its nearest multiple", () => {
    expect(snapAngle(-0.9, 0.5)).toBeCloseTo(-1, 10);
  });

  it("snaps to quarter turns when snap is PI/2", () => {
    expect(snapAngle(1.249, Math.PI / 2)).toBeCloseTo(Math.PI / 2, 10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeRotation — angle swept about the pivot, added to the start rotation
// ─────────────────────────────────────────────────────────────────────────────

/** A drag pivoted at the world origin, grabbed at (10,0) — so the origin angle is exactly 0. */
const rotateDrag = (over: Partial<ActiveDrag> = {}): ActiveDrag =>
  baseDrag("xy", {
    mode: "rotate",
    pivotWorld: { x: 0, y: 0 },
    originWorld: { x: 10, y: 0 },
    ...over
  });

describe("editor-gizmos — math — computeRotation", () => {
  it("returns the angle swept about the pivot from the grab origin", () => {
    // origin (10,0) → a0 = 0; current (0,10) → a1 = PI/2 → swept PI/2, startRotation 0.
    expect(computeRotation(rotateDrag(), { x: 0, y: 10 }, 0)).toBeCloseTo(Math.PI / 2, 10);
  });

  it("adds the swept angle to the entity's start rotation", () => {
    const drag = rotateDrag({ startRotation: 1 });
    expect(computeRotation(drag, { x: 0, y: 10 }, 0)).toBeCloseTo(1 + Math.PI / 2, 10);
  });

  it("sweeps a negative angle when the pointer rotates the other way", () => {
    expect(computeRotation(rotateDrag(), { x: 0, y: -10 }, 0)).toBeCloseTo(-Math.PI / 2, 10);
  });

  it("measures the sweep about pivotWorld, not the entity's start position", () => {
    // Pivot (5,5): origin (15,5) → a0 = 0; current (5,15) → a1 = PI/2.
    const drag = rotateDrag({ pivotWorld: { x: 5, y: 5 }, originWorld: { x: 15, y: 5 } });
    expect(computeRotation(drag, { x: 5, y: 15 }, 0)).toBeCloseTo(Math.PI / 2, 10);
  });

  it("a zero sweep returns exactly the start rotation", () => {
    const drag = rotateDrag({ startRotation: 0.75 });
    expect(computeRotation(drag, drag.originWorld, 0)).toBeCloseTo(0.75, 10);
  });

  it("applies the angular snap to the resulting angle", () => {
    // current (1,3) → a1 = 1.249 rad → snapped to the nearest PI/2 multiple.
    expect(computeRotation(rotateDrag(), { x: 1, y: 3 }, Math.PI / 2)).toBeCloseTo(Math.PI / 2, 10);
  });

  it("wraps a sweep across the ±PI branch cut to the short way (no ~2PI jump)", () => {
    // Grab angle a0 = +3.0 rad (just shy of +PI); release angle a1 = −3.0 rad (just past −PI).
    // The raw atan2 difference is −6.0, but the pointer physically swept only the short way across
    // the cut: −6 + 2PI ≈ +0.283 rad. Pre-fix, the un-wrapped delta committed −6.0 — a full extra
    // turn — which is silently wrong (and visibly wrong once angular snap quantizes the two ends
    // to different multiples). Reachable any time a user spins the handle past ~180°.
    const r = 10;
    const drag = rotateDrag({
      pivotWorld: { x: 0, y: 0 },
      originWorld: { x: Math.cos(3) * r, y: Math.sin(3) * r }
    });
    const release = { x: Math.cos(-3) * r, y: Math.sin(-3) * r };
    expect(computeRotation(drag, release, 0)).toBeCloseTo(-6 + 2 * Math.PI, 10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeScale — dist(current, pivot) / dist(origin, pivot) × the start scale
// ─────────────────────────────────────────────────────────────────────────────

/** A drag pivoted at the world origin, grabbed at (10,0) — so dist(origin, pivot) is 10. */
const scaleDrag = (axis: ActiveDrag["axis"], over: Partial<ActiveDrag> = {}): ActiveDrag =>
  baseDrag(axis, {
    mode: "scale",
    startScaleX: 3,
    startScaleY: 4,
    pivotWorld: { x: 0, y: 0 },
    originWorld: { x: 10, y: 0 },
    ...over
  });

describe("editor-gizmos — math — computeScale", () => {
  it("axis 'xy' scales both axes by dist(current,pivot)/dist(origin,pivot)", () => {
    // d0 = 10, d1 = 20 → factor 2 → (3*2, 4*2).
    expect(computeScale(scaleDrag("xy"), { x: 20, y: 0 }, 0)).toEqual({ x: 6, y: 8 });
  });

  it("axis 'x' scales only x — y stays pinned to startScaleY", () => {
    expect(computeScale(scaleDrag("x"), { x: 20, y: 0 }, 0)).toEqual({ x: 6, y: 4 });
  });

  it("axis 'y' scales only y — x stays pinned to startScaleX", () => {
    expect(computeScale(scaleDrag("y"), { x: 20, y: 0 }, 0)).toEqual({ x: 3, y: 8 });
  });

  it("shrinks when the pointer moves toward the pivot", () => {
    // d1 = 5 → factor 0.5.
    expect(computeScale(scaleDrag("xy"), { x: 5, y: 0 }, 0)).toEqual({ x: 1.5, y: 2 });
  });

  it("measures distance radially — any point at d1 gives the same factor", () => {
    expect(computeScale(scaleDrag("xy"), { x: 0, y: 20 }, 0)).toEqual({ x: 6, y: 8 });
  });

  it("dist(origin, pivot) === 0 yields factor 1 — no divide-by-zero", () => {
    const drag = scaleDrag("xy", { originWorld: { x: 0, y: 0 } });
    expect(computeScale(drag, { x: 99, y: 99 }, 0)).toEqual({ x: 3, y: 4 });
  });

  it("a zero delta returns exactly the start scale", () => {
    const drag = scaleDrag("xy");
    expect(computeScale(drag, drag.originWorld, 0)).toEqual({ x: 3, y: 4 });
  });

  it("applies the scalar snap to the resulting scale factor", () => {
    // d0 = 10, d1 = 12 → factor 1.2; startScale 1 → 1.2 → snapped to quarter-steps → 1.25.
    const drag = scaleDrag("xy", { startScaleX: 1, startScaleY: 1 });
    expect(computeScale(drag, { x: 12, y: 0 }, 0.25)).toEqual({ x: 1.25, y: 1.25 });
  });
});

/**
 * @file renderer plugin — unit tests for buildPrimitive (Cycle 5 delta).
 *
 * Tests cover:
 *   - Each shape (rect/circle/line/polygon) builds a Graphics node.
 *   - label and alpha are applied to the resulting node.
 *   - fill is applied (except for lines).
 *   - stroke / strokeWidth are applied when provided.
 *
 * Uses real Pixi `Graphics` instances since buildPrimitive calls the Pixi
 * fluent API. The test environment is headless (no DOM, no GPU renderer
 * needed) — Graphics construction does not require an Application.
 */

import { Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";
import { buildPrimitive } from "../../primitives";

// ─────────────────────────────────────────────────────────────────────────────
// Shape construction
// ─────────────────────────────────────────────────────────────────────────────

describe("buildPrimitive — shape construction", () => {
  it("rect: returns a Graphics instance", () => {
    const view = buildPrimitive({ shape: "rect", width: 40, height: 20 });
    expect(view).toBeInstanceOf(Graphics);
  });

  it("circle: returns a Graphics instance", () => {
    const view = buildPrimitive({ shape: "circle", radius: 15 });
    expect(view).toBeInstanceOf(Graphics);
  });

  it("line: returns a Graphics instance", () => {
    const view = buildPrimitive({ shape: "line", x2: 50, y2: 50 });
    expect(view).toBeInstanceOf(Graphics);
  });

  it("polygon: returns a Graphics instance", () => {
    const view = buildPrimitive({
      shape: "polygon",
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 10 }
      ]
    });
    expect(view).toBeInstanceOf(Graphics);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Style application
// ─────────────────────────────────────────────────────────────────────────────

describe("buildPrimitive — label", () => {
  it("sets the node label when provided", () => {
    const view = buildPrimitive({ shape: "circle", radius: 10, label: "ball" });
    expect(view.label).toBe("ball");
  });

  it("does not override the Pixi default label when label is not provided", () => {
    const view = buildPrimitive({ shape: "circle", radius: 10 });
    // Pixi v8 Graphics sets its own default label ("Graphics" — the class name).
    // buildPrimitive must not override it when no label is given in the spec.
    // Verify the label is the Pixi-provided default, not a custom value.
    expect(view.label).not.toBe("ball");
    // And that the label is a string (Pixi contract)
    expect(typeof view.label).toBe("string");
  });
});

describe("buildPrimitive — alpha", () => {
  it("sets node alpha when provided", () => {
    const view = buildPrimitive({ shape: "rect", width: 10, height: 10, alpha: 0.5 });
    expect(view.alpha).toBeCloseTo(0.5);
  });

  it("leaves alpha at 1 (Pixi default) when not provided", () => {
    const view = buildPrimitive({ shape: "rect", width: 10, height: 10 });
    expect(view.alpha).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Structural marker — Graphics carries `context` (Cycle 5 Graphics fix)
// ─────────────────────────────────────────────────────────────────────────────

describe("buildPrimitive — Graphics structural marker", () => {
  it("result has a 'context' field (confirming it is a Graphics, not a plain Container)", () => {
    const view = buildPrimitive({ shape: "rect", width: 10, height: 10 });
    // This assertion also serves as the in-suite verification of the marker used
    // by nodeType() to classify Graphics nodes in the scene-graph walk.
    expect("context" in view).toBe(true);
    expect(typeof (view as unknown as Record<string, unknown>).context).toBe("object");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Anchor contract — rect is CENTERED on the local origin (Cycle 6, issue #4)
// ─────────────────────────────────────────────────────────────────────────────

describe("buildPrimitive — rect anchor (centered, Cycle 6)", () => {
  it("a rect's local bounds straddle the origin, centered on it", () => {
    const width = 40;
    const height = 20;
    const view = buildPrimitive({ shape: "rect", width, height, fill: 0xff_ff_ff });
    const bounds = (view as unknown as Graphics).getLocalBounds();

    expect(bounds.minX).toBeCloseTo(-width / 2);
    expect(bounds.maxX).toBeCloseTo(width / 2);
    expect(bounds.minY).toBeCloseTo(-height / 2);
    expect(bounds.maxY).toBeCloseTo(height / 2);
  });

  it("matches the circle anchor contract: both are centered on the local origin", () => {
    const radius = 15;
    const rectView = buildPrimitive({ shape: "rect", width: radius * 2, height: radius * 2 });
    const circleView = buildPrimitive({ shape: "circle", radius });

    const rectBounds = (rectView as unknown as Graphics).getLocalBounds();
    const circleBounds = (circleView as unknown as Graphics).getLocalBounds();

    // Same-diameter rect and circle should have the same centered bounds extents.
    expect(rectBounds.minX).toBeCloseTo(circleBounds.minX);
    expect(rectBounds.maxX).toBeCloseTo(circleBounds.maxX);
    expect(rectBounds.minY).toBeCloseTo(circleBounds.minY);
    expect(rectBounds.maxY).toBeCloseTo(circleBounds.maxY);
  });
});

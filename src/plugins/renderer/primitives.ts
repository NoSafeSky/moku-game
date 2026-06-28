/**
 * @file renderer plugin — primitive shape construction.
 *
 * Builds a Pixi `Graphics` from a plain {@link PrimitiveSpec} (rect / circle /
 * line / polygon + fill/stroke/alpha/label). Keeps Pixi drawing calls out of
 * api.ts; Pixi stays confined to the renderer's domain files.
 */

import type { Container } from "pixi.js";
import { Graphics } from "pixi.js";
import type { PrimitiveSpec } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Shape drawing helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Draw the geometric shape onto the given Graphics object based on the spec.
 *
 * @param g - The Pixi Graphics to draw onto.
 * @param spec - The primitive spec describing the shape and style.
 * @example
 * ```ts
 * drawShape(g, { shape: "rect", width: 40, height: 20 });
 * ```
 */
const drawShape = (g: Graphics, spec: PrimitiveSpec): void => {
  switch (spec.shape) {
    case "rect": {
      g.rect(0, 0, spec.width, spec.height);
      if (spec.fill !== undefined) {
        g.fill({ color: spec.fill });
      }

      break;
    }
    case "circle": {
      g.circle(0, 0, spec.radius);
      if (spec.fill !== undefined) {
        g.fill({ color: spec.fill });
      }

      break;
    }
    case "line": {
      g.moveTo(0, 0).lineTo(spec.x2, spec.y2);
      // Lines have no fill — only stroke is applied (below)

      break;
    }
    case "polygon": {
      const flat = spec.points.flatMap(p => [p.x, p.y]);
      g.poly(flat);
      if (spec.fill !== undefined) {
        g.fill({ color: spec.fill });
      }

      break;
    }
    // No default
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Public factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a Pixi `Graphics` for the given primitive spec.
 *
 * Draws the requested shape using the Pixi v8 fluent Graphics API, then applies
 * shared style (fill, stroke, alpha, label). Returns the Graphics cast as
 * `Container` so callers stay decoupled from the Pixi class hierarchy while
 * the renderer boundary is maintained.
 *
 * @param spec - Plain, JSON-describable shape + style spec (no Pixi types).
 * @returns A Pixi `Graphics` instance ready to be added to the stage.
 * @example
 * ```ts
 * const view = buildPrimitive({ shape: "circle", radius: 10, fill: 0xff0000, label: "ball" });
 * stage.addChild(view);
 * ```
 */
export const buildPrimitive = (spec: PrimitiveSpec): Container => {
  const g = new Graphics();

  // Draw the shape (fill applied per-shape above, except for lines)
  drawShape(g, spec);

  // Apply stroke when provided (applies to all shapes including line)
  if (spec.stroke !== undefined) {
    g.stroke({ color: spec.stroke, width: spec.strokeWidth ?? 1 });
  }

  // Apply shared style fields
  if (spec.label !== undefined) {
    g.label = spec.label;
  }
  if (spec.alpha !== undefined) {
    g.alpha = spec.alpha;
  }

  return g;
};

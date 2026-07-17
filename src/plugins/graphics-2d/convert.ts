/**
 * @file graphics-2d plugin — pure, Pixi-free conversion helpers.
 *
 * Component values in; the renderer's plain-data specs and cheap change-detection signatures out.
 * Imports the renderer's `PrimitiveSpec` TYPE only (it is plain data — no Pixi), and touches
 * neither the world nor a context, so the reconcile math is unit-testable without a kernel.
 */
import type { PrimitiveSpec } from "../renderer/types";
import type { ShapeValue, SpriteRendererValue } from "./types";

/** A well-formed `#rrggbb` color: an optional `#` then exactly six hex digits. */
const HEX_COLOR = /^#?[0-9a-f]{6}$/i;

/** The renderer node label every Shape view carries, so `renderer.tree()` reports it. */
const SHAPE_LABEL = "Shape";

/**
 * Parses a `#rrggbb` hex color string to the hex int the renderer's `PrimitiveStyle` expects.
 *
 * Anything malformed — an empty string, a wrong digit count, a non-hex digit, a CSS color name —
 * yields `0` (black) rather than throwing: colors arrive from authored, inspector-editable data, so
 * a half-typed value must degrade to a visible shape rather than break the render tick.
 *
 * @param hex - The color string, with or without the leading `#`.
 * @returns The color as a hex int (e.g. `0xff_00_00`), or `0` when `hex` is malformed.
 * @example
 * ```ts
 * parseHexColor("#ff0000"); // 0xff0000
 * parseHexColor("nope");    // 0
 * ```
 */
export const parseHexColor = (hex: string): number => {
  if (!HEX_COLOR.test(hex)) return 0;
  return Number.parseInt(hex.replace("#", ""), 16);
};

/**
 * Maps a Shape component value to the renderer's plain-data `PrimitiveSpec`, converting the
 * authored `#rrggbb` strings to the hex ints the renderer draws with.
 *
 * `stroke` is included ONLY when `strokeWidth > 0` — `PrimitiveStyle.stroke` is optional under
 * `exactOptionalPropertyTypes`, so an unstroked shape must OMIT the key rather than set it to
 * `undefined`. `radius` drives a `"circle"`; `width`/`height` drive a `"rect"`.
 *
 * @param shape - The Shape component value to convert.
 * @returns The equivalent `PrimitiveSpec`, labelled `"Shape"`.
 * @example
 * ```ts
 * renderer.attachPrimitive(entity, shapeToPrimitiveSpec(shape));
 * ```
 */
export const shapeToPrimitiveSpec = (shape: ShapeValue): PrimitiveSpec => {
  const style = {
    fill: parseHexColor(shape.fill),
    ...(shape.strokeWidth > 0 ? { stroke: parseHexColor(shape.stroke) } : {}),
    strokeWidth: shape.strokeWidth,
    label: SHAPE_LABEL
  };

  return shape.kind === "circle"
    ? { shape: "circle", radius: shape.radius, ...style }
    : { shape: "rect", width: shape.width, height: shape.height, ...style };
};

/**
 * Builds the cheap value signature for a Shape — every field that changes the built view, joined.
 *
 * The render-sync system compares this against the signature the entity's current view was built
 * from; a mismatch triggers a rebuild. A string compare is enough (and cheaper than a deep diff)
 * because the reconcile pass only runs when the world's change epoch has advanced.
 *
 * @param shape - The Shape component value to sign.
 * @returns The signature string.
 * @example
 * ```ts
 * const changed = shapeSig(next) !== tracked.sig;
 * ```
 */
export const shapeSig = (shape: ShapeValue): string =>
  `${shape.kind}|${shape.width}|${shape.height}|${shape.radius}|${shape.fill}|${shape.stroke}|${shape.strokeWidth}`;

/**
 * Builds the cheap value signature for a SpriteRenderer, mirroring {@link shapeSig}.
 *
 * `sortingLayer`/`orderInLayer` are signed even though P1 does not yet apply z-order, so the view
 * already rebuilds on an authored change once the renderer grows a z seam (roadmap F1).
 *
 * @param sprite - The SpriteRenderer component value to sign.
 * @returns The signature string.
 * @example
 * ```ts
 * const changed = spriteSig(next) !== tracked.sig;
 * ```
 */
export const spriteSig = (sprite: SpriteRendererValue): string =>
  `${sprite.sprite}|${sprite.tint}|${sprite.flipX}|${sprite.sortingLayer}|${sprite.orderInLayer}`;

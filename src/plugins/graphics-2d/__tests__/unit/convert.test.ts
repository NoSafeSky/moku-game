/**
 * @file graphics-2d plugin — pure, Pixi-free conversion helpers.
 *
 * `parseHexColor` (hex string → hex int, 0 on malformed), `shapeToPrimitiveSpec` (ShapeValue →
 * the renderer's plain-data PrimitiveSpec, with `stroke` present ONLY when `strokeWidth > 0` —
 * the `exactOptionalPropertyTypes` conditional-spread contract), and the two per-entity value
 * signatures that drive the render-sync system's rebuild detection.
 */
import { describe, expect, it } from "vitest";
import { createShape, createSpriteRenderer } from "../../components";
import { parseHexColor, shapeSig, shapeToPrimitiveSpec, spriteSig } from "../../convert";
import type { ShapeValue, SpriteRendererValue } from "../../types";

describe("parseHexColor", () => {
  it("parses a #rrggbb string to its hex int", () => {
    expect(parseHexColor("#ff0000")).toBe(0xff_00_00);
    expect(parseHexColor("#00ff00")).toBe(0x00_ff_00);
    expect(parseHexColor("#cccccc")).toBe(0xcc_cc_cc);
  });

  it("parses #000000 to 0", () => {
    expect(parseHexColor("#000000")).toBe(0);
  });

  it("parses #ffffff to the full white int", () => {
    expect(parseHexColor("#ffffff")).toBe(0xff_ff_ff);
  });

  it("accepts an uppercase hex string", () => {
    expect(parseHexColor("#FF00AA")).toBe(0xff_00_aa);
  });

  it("accepts a bare (unprefixed) 6-digit hex string", () => {
    expect(parseHexColor("ff0000")).toBe(0xff_00_00);
  });

  it("returns 0 for a malformed value", () => {
    expect(parseHexColor("")).toBe(0);
    expect(parseHexColor("#")).toBe(0);
    expect(parseHexColor("nope")).toBe(0);
    expect(parseHexColor("#ff")).toBe(0);
    expect(parseHexColor("#gggggg")).toBe(0);
    expect(parseHexColor("#ff00000")).toBe(0);
  });
});

describe("shapeToPrimitiveSpec", () => {
  it("maps a rect Shape to a rect PrimitiveSpec labelled Shape", () => {
    const shape: ShapeValue = {
      kind: "rect",
      width: 40,
      height: 20,
      radius: 50,
      fill: "#ff0000",
      stroke: "#000000",
      strokeWidth: 0
    };

    expect(shapeToPrimitiveSpec(shape)).toEqual({
      shape: "rect",
      width: 40,
      height: 20,
      fill: 0xff_00_00,
      strokeWidth: 0,
      label: "Shape"
    });
  });

  it("maps a circle Shape to a circle PrimitiveSpec carrying radius, not width/height", () => {
    const shape: ShapeValue = {
      kind: "circle",
      width: 40,
      height: 20,
      radius: 7,
      fill: "#00ff00",
      stroke: "#000000",
      strokeWidth: 0
    };
    const spec = shapeToPrimitiveSpec(shape);

    expect(spec).toEqual({
      shape: "circle",
      radius: 7,
      fill: 0x00_ff_00,
      strokeWidth: 0,
      label: "Shape"
    });
    expect("width" in spec).toBe(false);
    expect("height" in spec).toBe(false);
  });

  it("omits stroke entirely when strokeWidth is 0", () => {
    const spec = shapeToPrimitiveSpec({ ...createShape(), stroke: "#123456", strokeWidth: 0 });

    expect("stroke" in spec).toBe(false);
  });

  it("includes the parsed stroke when strokeWidth is above 0", () => {
    const spec = shapeToPrimitiveSpec({ ...createShape(), stroke: "#123456", strokeWidth: 3 });

    expect(spec.stroke).toBe(0x12_34_56);
    expect(spec.strokeWidth).toBe(3);
  });

  it("maps a malformed fill to 0 rather than throwing", () => {
    const spec = shapeToPrimitiveSpec({ ...createShape(), fill: "rebeccapurple" });

    expect(spec.fill).toBe(0);
  });
});

describe("shapeSig", () => {
  it("is stable for an unchanged value", () => {
    expect(shapeSig(createShape())).toBe(shapeSig(createShape()));
  });

  it("differs when any signature-carrying field differs", () => {
    const base = createShape();
    const baseline = shapeSig(base);
    const mutations: ReadonlyArray<Partial<ShapeValue>> = [
      { kind: "circle" },
      { width: 1 },
      { height: 1 },
      { radius: 1 },
      { fill: "#111111" },
      { stroke: "#111111" },
      { strokeWidth: 2 }
    ];

    for (const mutation of mutations) {
      expect(shapeSig({ ...base, ...mutation })).not.toBe(baseline);
    }
  });
});

describe("spriteSig", () => {
  it("is stable for an unchanged value", () => {
    expect(spriteSig(createSpriteRenderer())).toBe(spriteSig(createSpriteRenderer()));
  });

  it("differs when any signature-carrying field differs", () => {
    const base = createSpriteRenderer();
    const baseline = spriteSig(base);
    const mutations: ReadonlyArray<Partial<SpriteRendererValue>> = [
      { sprite: "ship" },
      { tint: "#ff0000" },
      { flipX: true },
      { sortingLayer: "UI" },
      { orderInLayer: 3 }
    ];

    for (const mutation of mutations) {
      expect(spriteSig({ ...base, ...mutation })).not.toBe(baseline);
    }
  });
});

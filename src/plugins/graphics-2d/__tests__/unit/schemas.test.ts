/**
 * @file graphics-2d plugin — reflection schema contracts.
 *
 * The two module-scope schemas are authored with the standalone `field` builder set, so they are
 * assertable without booting the kernel. Covers the NEW Phase-1 `asset-ref` kind on
 * `SpriteRenderer.sprite`, every other field's `kind`, and the exact `select` option lists.
 */
import { describe, expect, it } from "vitest";
import { createShape, createSpriteRenderer } from "../../components";
import { shapeSchema, spriteRendererSchema } from "../../schemas";

describe("spriteRendererSchema", () => {
  it("types sprite as the NEW asset-ref field kind", () => {
    expect(spriteRendererSchema.sprite?.kind).toBe("asset-ref");
  });

  it("types tint as a color control", () => {
    expect(spriteRendererSchema.tint?.kind).toBe("color");
  });

  it("types flipX as a boolean control", () => {
    expect(spriteRendererSchema.flipX?.kind).toBe("boolean");
  });

  it("types sortingLayer as a select over the five contract layers", () => {
    const sortingLayer = spriteRendererSchema.sortingLayer;

    expect(sortingLayer?.kind).toBe("select");
    expect(sortingLayer?.kind === "select" && sortingLayer.options).toEqual([
      "Background",
      "Default",
      "Enemies",
      "Player",
      "UI"
    ]);
  });

  it("types orderInLayer as a whole-number control", () => {
    const orderInLayer = spriteRendererSchema.orderInLayer;

    expect(orderInLayer?.kind).toBe("number");
    expect(orderInLayer?.kind === "number" && orderInLayer.step).toBe(1);
  });

  it("covers exactly the SpriteRenderer value fields", () => {
    expect(Object.keys(spriteRendererSchema).toSorted()).toEqual(
      Object.keys(createSpriteRenderer()).toSorted()
    );
  });

  it("offers the component's default sortingLayer as a select option", () => {
    const sortingLayer = spriteRendererSchema.sortingLayer;
    const options = sortingLayer?.kind === "select" ? sortingLayer.options : [];

    expect(options).toContain(createSpriteRenderer().sortingLayer);
  });
});

describe("shapeSchema", () => {
  it("types kind as a select over rect and circle", () => {
    const kind = shapeSchema.kind;

    expect(kind?.kind).toBe("select");
    expect(kind?.kind === "select" && kind.options).toEqual(["rect", "circle"]);
  });

  it("types the four measurement fields as numbers floored at 0", () => {
    for (const key of ["width", "height", "radius", "strokeWidth"]) {
      const spec = shapeSchema[key];

      expect(spec?.kind).toBe("number");
      expect(spec?.kind === "number" && spec.min).toBe(0);
    }
  });

  it("types fill and stroke as color controls", () => {
    expect(shapeSchema.fill?.kind).toBe("color");
    expect(shapeSchema.stroke?.kind).toBe("color");
  });

  it("covers exactly the Shape value fields", () => {
    expect(Object.keys(shapeSchema).toSorted()).toEqual(Object.keys(createShape()).toSorted());
  });

  it("offers the component's default kind as a select option", () => {
    const kind = shapeSchema.kind;
    const options = kind?.kind === "select" ? kind.options : [];

    expect(options).toContain(createShape().kind);
  });
});

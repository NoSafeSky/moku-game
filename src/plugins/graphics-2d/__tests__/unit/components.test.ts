/**
 * @file graphics-2d plugin — component default factories + catalog projection.
 *
 * Proves the two `create()` factories return the exact contract default shapes, that each call
 * returns a FRESH object (the world's SoA default and the component-registry `defaults` must never
 * alias one another), and that `catalogEntries()` projects those same defaults into the three
 * Add-Component catalog entries.
 */
import { describe, expect, it } from "vitest";
import { catalogEntries, createShape, createSpriteRenderer } from "../../components";

describe("createSpriteRenderer", () => {
  it("returns the contract default SpriteRenderer shape", () => {
    expect(createSpriteRenderer()).toEqual({
      sprite: "",
      tint: "#ffffff",
      flipX: false,
      sortingLayer: "Default",
      orderInLayer: 0
    });
  });

  it("returns a fresh object on every call (no shared reference)", () => {
    const first = createSpriteRenderer();
    const second = createSpriteRenderer();

    expect(first).not.toBe(second);

    first.sprite = "ship";
    expect(second.sprite).toBe("");
  });
});

describe("createShape", () => {
  it("returns the contract default Shape shape", () => {
    expect(createShape()).toEqual({
      kind: "rect",
      width: 100,
      height: 100,
      radius: 50,
      fill: "#cccccc",
      stroke: "#000000",
      strokeWidth: 0
    });
  });

  it("returns a fresh object on every call (no shared reference)", () => {
    const first = createShape();
    const second = createShape();

    expect(first).not.toBe(second);

    first.width = 10;
    expect(second.width).toBe(100);
  });
});

describe("catalogEntries", () => {
  it("projects the three Add-Component catalog entries in registration order", () => {
    expect(catalogEntries().map(entry => entry.name)).toEqual([
      "Transform",
      "SpriteRenderer",
      "Shape"
    ]);
  });

  it("marks Transform non-addable under the Transform category with renderer's create() defaults", () => {
    const transform = catalogEntries().find(entry => entry.name === "Transform");

    expect(transform?.addable).toBe(false);
    expect(transform?.category).toBe("Transform");
    expect(transform?.defaults).toEqual({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
  });

  it("marks SpriteRenderer addable under Rendering with the create() defaults", () => {
    const sprite = catalogEntries().find(entry => entry.name === "SpriteRenderer");

    expect(sprite?.addable).toBe(true);
    expect(sprite?.category).toBe("Rendering");
    expect(sprite?.defaults).toEqual(createSpriteRenderer());
  });

  it("marks Shape addable under Rendering with the create() defaults", () => {
    const shape = catalogEntries().find(entry => entry.name === "Shape");

    expect(shape?.addable).toBe(true);
    expect(shape?.category).toBe("Rendering");
    expect(shape?.defaults).toEqual(createShape());
  });

  it("returns fresh defaults per call so a mutated catalog entry never leaks", () => {
    const first = catalogEntries().find(entry => entry.name === "Shape");
    const second = catalogEntries().find(entry => entry.name === "Shape");

    expect(first?.defaults).not.toBe(second?.defaults);
  });
});

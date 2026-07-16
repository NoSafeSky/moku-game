import { describe, expect, it } from "vitest";

import { inferDescriptors, labelFor } from "../../infer";

describe("reflection — inferDescriptors", () => {
  it("infers a number descriptor for a numeric key", () => {
    const descriptors = inferDescriptors({ hp: 100 }, true);

    expect(descriptors).toContainEqual({ kind: "number", key: "hp", label: "Hp" });
  });

  it("infers a boolean descriptor for a boolean key", () => {
    const descriptors = inferDescriptors({ alive: true }, true);

    expect(descriptors).toContainEqual({ kind: "boolean", key: "alive", label: "Alive" });
  });

  it("infers a string descriptor for a string key", () => {
    const descriptors = inferDescriptors({ name: "orc" }, true);

    expect(descriptors).toContainEqual({ kind: "string", key: "name", label: "Name" });
  });

  it("infers a vector2 descriptor for a {x,y} pair", () => {
    const descriptors = inferDescriptors({ pos: { x: 1, y: 2 } }, true);

    expect(descriptors).toContainEqual({ kind: "vector2", key: "pos", label: "Pos" });
  });

  it("skips a {x,y,z} triple (not a vector2)", () => {
    const descriptors = inferDescriptors({ pos: { x: 1, y: 2, z: 3 } }, true);

    expect(descriptors).toStrictEqual([]);
  });

  it("skips a {x} singleton (not a vector2)", () => {
    const descriptors = inferDescriptors({ pos: { x: 1 } }, true);

    expect(descriptors).toStrictEqual([]);
  });

  it("skips an array-valued key", () => {
    const descriptors = inferDescriptors({ tags: ["a", "b"] }, true);

    expect(descriptors).toStrictEqual([]);
  });

  it("skips a function-valued key", () => {
    const descriptors = inferDescriptors({ onDeath: () => {} }, true);

    expect(descriptors).toStrictEqual([]);
  });

  it("returns [] for a non-object value", () => {
    expect(inferDescriptors(42, true)).toStrictEqual([]);
    expect(inferDescriptors("nope", true)).toStrictEqual([]);
    expect(inferDescriptors(undefined, true)).toStrictEqual([]);
  });

  it("infers multiple keys in enumeration order", () => {
    const descriptors = inferDescriptors({ hp: 100, alive: true }, true);

    expect(descriptors).toHaveLength(2);
    expect(descriptors[0]).toStrictEqual({ kind: "number", key: "hp", label: "Hp" });
    expect(descriptors[1]).toStrictEqual({ kind: "boolean", key: "alive", label: "Alive" });
  });

  it("Phase-1 F1 — never classifies a number key as entity-ref (stays plain number)", () => {
    const descriptors = inferDescriptors({ target: 42 }, true);

    expect(descriptors).toContainEqual({ kind: "number", key: "target", label: "Target" });
    expect(descriptors.some(descriptor => descriptor.kind === "entity-ref")).toBe(false);
  });

  it("Phase-1 F1 — never classifies a string key as asset-ref (stays plain string)", () => {
    const descriptors = inferDescriptors({ icon: "hero" }, true);

    expect(descriptors).toContainEqual({ kind: "string", key: "icon", label: "Icon" });
    expect(descriptors.some(descriptor => descriptor.kind === "asset-ref")).toBe(false);
  });
});

describe("reflection — labelFor", () => {
  it("humanizes camelCase keys to Title Case", () => {
    expect(labelFor("scaleX", true)).toBe("Scale X");
  });

  it("humanizes snake_case keys to Title Case", () => {
    expect(labelFor("hit_points", true)).toBe("Hit Points");
  });

  it("returns the raw key when humanize is false", () => {
    expect(labelFor("scaleX", false)).toBe("scaleX");
  });

  it("returns the raw key unchanged for a single lowercase word when humanize is false", () => {
    expect(labelFor("hp", false)).toBe("hp");
  });

  it("capitalizes a single lowercase word when humanize is true", () => {
    expect(labelFor("hp", true)).toBe("Hp");
  });
});

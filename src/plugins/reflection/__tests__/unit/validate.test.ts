import { describe, expect, it } from "vitest";

import type { FieldDescriptor } from "../../types";
import { validateAgainst } from "../../validate";

const numberField: FieldDescriptor = { kind: "number", key: "hp", label: "Hp", min: 0, max: 100 };
const selectField: FieldDescriptor = {
  kind: "select",
  key: "state",
  label: "State",
  options: ["idle", "dead"]
};
const vectorField: FieldDescriptor = { kind: "vector2", key: "pos", label: "Pos" };
const readonlyField: FieldDescriptor = {
  kind: "number",
  key: "speed",
  label: "Speed",
  readonly: true
};
const entityRefField: FieldDescriptor = { kind: "entity-ref", key: "target", label: "Target" };
const assetRefField: FieldDescriptor = { kind: "asset-ref", key: "icon", label: "Icon" };

describe("reflection — validateAgainst", () => {
  it("returns ok:true for an empty descriptor set (permissive)", () => {
    expect(validateAgainst([], { anything: 1 })).toStrictEqual({ ok: true });
  });

  it("accepts an in-range number", () => {
    expect(validateAgainst([numberField], { hp: 50 })).toStrictEqual({ ok: true });
  });

  it("accepts a valid select value", () => {
    expect(validateAgainst([selectField], { state: "idle" })).toStrictEqual({ ok: true });
  });

  it("accepts a correct vector2 shape", () => {
    expect(validateAgainst([vectorField], { pos: { x: 1, y: 2 } })).toStrictEqual({ ok: true });
  });

  it("rejects a string where a number is expected (type error)", () => {
    const result = validateAgainst([numberField], { hp: "oops" });

    expect(result.ok).toBe(false);
    expect(result).toStrictEqual({
      ok: false,
      errors: [{ key: "hp", message: "expected a number" }]
    });
  });

  it("rejects an out-of-range number (range error)", () => {
    const result = validateAgainst([numberField], { hp: 150 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.key).toBe("hp");
    }
  });

  it("rejects a select value not in options", () => {
    const result = validateAgainst([selectField], { state: "flying" });

    expect(result).toStrictEqual({
      ok: false,
      errors: [{ key: "state", message: "value not in options" }]
    });
  });

  it("rejects a write to a readonly field", () => {
    const result = validateAgainst([readonlyField], { speed: 10 });

    expect(result).toStrictEqual({
      ok: false,
      errors: [{ key: "speed", message: "field is read-only" }]
    });
  });

  it("rejects a {x}-only vector2 (shape error)", () => {
    const result = validateAgainst([vectorField], { pos: { x: 1 } });

    expect(result).toStrictEqual({
      ok: false,
      errors: [{ key: "pos", message: "expected a { x, y } vector" }]
    });
  });

  it("rejects an unknown field key", () => {
    const result = validateAgainst([numberField], { level: 5 });

    expect(result).toStrictEqual({
      ok: false,
      errors: [{ key: "level", message: "unknown field" }]
    });
  });

  it("collects one error per offending field across multiple fields", () => {
    const result = validateAgainst([numberField, selectField], { hp: 999, state: "flying" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(2);
      expect(result.errors.map(error => error.key).toSorted()).toStrictEqual(["hp", "state"]);
    }
  });

  it("accepts a boolean field with a real boolean and rejects a non-boolean", () => {
    const booleanField: FieldDescriptor = { kind: "boolean", key: "alive", label: "Alive" };

    expect(validateAgainst([booleanField], { alive: false })).toStrictEqual({ ok: true });
    expect(validateAgainst([booleanField], { alive: "yes" })).toStrictEqual({
      ok: false,
      errors: [{ key: "alive", message: "expected a boolean" }]
    });
  });

  it("accepts a string field with a real string and rejects a non-string", () => {
    const stringField: FieldDescriptor = { kind: "string", key: "name", label: "Name" };

    expect(validateAgainst([stringField], { name: "orc" })).toStrictEqual({ ok: true });
    expect(validateAgainst([stringField], { name: 42 })).toStrictEqual({
      ok: false,
      errors: [{ key: "name", message: "expected a string" }]
    });
  });

  it("accepts a color field with a hex string and rejects a non-string", () => {
    const colorField: FieldDescriptor = { kind: "color", key: "tint", label: "Tint" };

    expect(validateAgainst([colorField], { tint: "#ff0000" })).toStrictEqual({ ok: true });
    expect(validateAgainst([colorField], { tint: 0xff_00_00 })).toStrictEqual({
      ok: false,
      errors: [{ key: "tint", message: "expected a color string" }]
    });
  });

  it("returns ok:true for an empty partial (nothing to check)", () => {
    expect(validateAgainst([numberField, selectField], {})).toStrictEqual({ ok: true });
  });

  it("Phase-1 F1 — entity-ref accepts a number", () => {
    expect(validateAgainst([entityRefField], { target: 42 })).toStrictEqual({ ok: true });
  });

  it("Phase-1 F1 — entity-ref accepts undefined (unset)", () => {
    expect(validateAgainst([entityRefField], { target: undefined })).toStrictEqual({ ok: true });
  });

  it("Phase-1 F1 — entity-ref rejects a string", () => {
    expect(validateAgainst([entityRefField], { target: "not-an-id" })).toStrictEqual({
      ok: false,
      errors: [{ key: "target", message: "expected an entity id" }]
    });
  });

  it("Phase-1 F1 — entity-ref rejects an object", () => {
    const result = validateAgainst([entityRefField], { target: { id: 1 } });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.key).toBe("target");
    }
  });

  it("Phase-1 F1 — asset-ref accepts a string", () => {
    expect(validateAgainst([assetRefField], { icon: "hero" })).toStrictEqual({ ok: true });
  });

  it("Phase-1 F1 — asset-ref accepts undefined (unset)", () => {
    expect(validateAgainst([assetRefField], { icon: undefined })).toStrictEqual({ ok: true });
  });

  it("Phase-1 F1 — asset-ref rejects a number", () => {
    expect(validateAgainst([assetRefField], { icon: 3 })).toStrictEqual({
      ok: false,
      errors: [{ key: "icon", message: "expected an asset alias string" }]
    });
  });

  it("Phase-1 F1 — entity-ref respects readonly", () => {
    const readonlyRef: FieldDescriptor = {
      kind: "entity-ref",
      key: "target",
      label: "Target",
      readonly: true
    };

    expect(validateAgainst([readonlyRef], { target: 1 })).toStrictEqual({
      ok: false,
      errors: [{ key: "target", message: "field is read-only" }]
    });
  });
});

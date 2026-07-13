import { describe, expect, it } from "vitest";

import { field } from "../../field";

describe("reflection — field builders", () => {
  it("number(opts) returns a NumberFieldSpec with the given bounds", () => {
    expect(field.number({ min: 0, max: 1, step: 0.1 })).toStrictEqual({
      kind: "number",
      min: 0,
      max: 1,
      step: 0.1
    });
  });

  it("number() with no opts returns only { kind } (no undefined-valued keys)", () => {
    const result = field.number();

    expect(result).toStrictEqual({ kind: "number" });
    expect(Object.keys(result)).toStrictEqual(["kind"]);
  });

  it("boolean() returns a bare BooleanFieldSpec", () => {
    expect(field.boolean()).toStrictEqual({ kind: "boolean" });
  });

  it("string() returns a bare StringFieldSpec", () => {
    expect(field.string()).toStrictEqual({ kind: "string" });
  });

  it("color() returns a bare ColorFieldSpec", () => {
    expect(field.color()).toStrictEqual({ kind: "color" });
  });

  it("vector2() returns a bare Vector2FieldSpec", () => {
    expect(field.vector2()).toStrictEqual({ kind: "vector2" });
  });

  it("select(options) returns a SelectFieldSpec carrying the options", () => {
    expect(field.select(["a", "b"])).toStrictEqual({ kind: "select", options: ["a", "b"] });
  });

  it("readonly(inner) preserves the inner kind and fields, adding readonly: true", () => {
    expect(field.readonly(field.number({ min: 0 }))).toStrictEqual({
      kind: "number",
      min: 0,
      readonly: true
    });
  });

  it("readonly(inner) works for non-number specs too", () => {
    expect(field.readonly(field.select(["idle", "run"]))).toStrictEqual({
      kind: "select",
      options: ["idle", "run"],
      readonly: true
    });
  });
});

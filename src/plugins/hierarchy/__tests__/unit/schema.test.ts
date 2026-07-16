/**
 * @file hierarchy plugin — unit tests for the pure Node reflection-schema builder (`schema.ts`).
 */
import { describe, expect, it } from "vitest";
import { field } from "../../../reflection";
import type { FieldBuilders } from "../../../reflection/types";
import { buildNodeSchema } from "../../schema";

describe("hierarchy — schema", () => {
  it("builds the Node schema from the real reflection field builders", () => {
    const schema = buildNodeSchema(field);

    expect(schema.name).toEqual({ kind: "string" });
    expect(schema.enabled).toEqual({ kind: "boolean" });
    expect(schema.order).toEqual({ kind: "number" });
    expect(schema.parent).toEqual({ kind: "entity-ref" });
  });

  it("is pure over the injected builder set — no reliance on the real reflection module", () => {
    const calls: string[] = [];
    const stubField: FieldBuilders = {
      number: () => {
        calls.push("number");
        return { kind: "number" };
      },
      boolean: () => {
        calls.push("boolean");
        return { kind: "boolean" };
      },
      string: () => {
        calls.push("string");
        return { kind: "string" };
      },
      color: () => ({ kind: "color" }),
      select: options => ({ kind: "select", options }),
      vector2: () => ({ kind: "vector2" }),
      entityRef: () => {
        calls.push("entity-ref");
        return { kind: "entity-ref" };
      },
      assetRef: () => ({ kind: "asset-ref" }),
      readonly: inner => ({ ...inner, readonly: true })
    };

    const schema = buildNodeSchema(stubField);

    expect(calls.toSorted()).toEqual(["boolean", "entity-ref", "number", "string"]);
    expect(schema.parent).toEqual({ kind: "entity-ref" });
  });
});

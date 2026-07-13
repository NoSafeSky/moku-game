import { describe, expect, expectTypeOf, it } from "vitest";

import { createApi } from "../../api";
import { field } from "../../field";
import type {
  Api,
  BooleanField,
  FieldDescriptor,
  NumberField,
  SelectField,
  ValidationResult
} from "../../types";

describe("reflection — FieldDescriptor discriminated union", () => {
  it("narrows to expose min/max only on the number member", () => {
    const descriptor: FieldDescriptor = {
      kind: "number",
      key: "hp",
      label: "Hp",
      min: 0,
      max: 100
    };

    if (descriptor.kind === "number") {
      expectTypeOf(descriptor).toEqualTypeOf<NumberField>();
      expectTypeOf(descriptor.min).toEqualTypeOf<number | undefined>();
    }

    expect(descriptor.kind).toBe("number");
  });

  it("narrows to expose options only on the select member", () => {
    const descriptor: FieldDescriptor = {
      kind: "select",
      key: "state",
      label: "State",
      options: ["idle", "dead"]
    };

    if (descriptor.kind === "select") {
      expectTypeOf(descriptor).toEqualTypeOf<SelectField>();
      expectTypeOf(descriptor.options).toEqualTypeOf<readonly string[]>();
    }

    expect(descriptor.kind).toBe("select");
  });

  it("boolean member has no min/options at the type level", () => {
    const descriptor: BooleanField = { kind: "boolean", key: "alive", label: "Alive" };

    expectTypeOf(descriptor).not.toHaveProperty("min");
    expectTypeOf(descriptor).not.toHaveProperty("options");
    expect(descriptor.kind).toBe("boolean");
  });
});

describe("reflection — field.* builder return types", () => {
  it("field.number returns NumberFieldSpec (no options property)", () => {
    expectTypeOf(field.number()).not.toHaveProperty("options");
    expect(field.number().kind).toBe("number");
  });

  it("field.select returns SelectFieldSpec (has options property)", () => {
    expectTypeOf(field.select(["a", "b"])).toHaveProperty("options");
    expect(field.select(["a", "b"]).kind).toBe("select");
  });
});

describe("reflection — no explicit generics on describe/register/validate", () => {
  it("describe/register/validate accept no type parameters", () => {
    // Type-only fixture — never invoked at runtime; exists so `@ts-expect-error` can assert that
    // describe/register/validate reject an explicit type argument.
    const typeOnlyChecks = (api: Api): void => {
      // @ts-expect-error -- describe takes no type parameters
      api.describe<string>("Enemy");
      // @ts-expect-error -- register takes no type parameters
      api.register<string>("Enemy", {});
      // @ts-expect-error -- validate takes no type parameters
      api.validate<string>("Enemy", {});
    };

    expect(typeof typeOnlyChecks).toBe("function");
    expectTypeOf<Api["describe"]>().parameters.toEqualTypeOf<[string]>();
    expectTypeOf(createApi).toBeFunction();
  });
});

describe("reflection — ValidationResult narrowing", () => {
  it("errors is reachable only in the ok:false branch", () => {
    const result: ValidationResult = { ok: false, errors: [{ key: "hp", message: "bad" }] };

    if (!result.ok) {
      expectTypeOf(result.errors).toEqualTypeOf<readonly { key: string; message: string }[]>();
      expect(result.errors).toHaveLength(1);
    }

    const okResult: ValidationResult = { ok: true };
    // @ts-expect-error -- `errors` does not exist on the `{ ok: true }` member without narrowing
    expect(okResult.errors).toBeUndefined();
  });
});

/**
 * @file editor-selection plugin — type-level contracts.
 *
 * Compile-time assertions over the public `Api` surface + `Events`: `pickAt` returns
 * `Entity | undefined`, `selected()` returns `readonly Entity[]`, `select`/`toggle`/
 * `isSelected` take a branded `Entity` (not a bare `number`), and the declared
 * `editor-selection:changed` event types its payload as `{ selected: readonly Entity[] }`.
 * Mirrors the sibling `camera` plugin's `types.test.ts`.
 */
import { describe, expectTypeOf, it } from "vitest";
import type { Entity } from "../../../ecs/types";
import type { Api, Config, Events } from "../../types";

describe("editor-selection Api — return-type contracts", () => {
  it("pickAt returns Entity | undefined", () => {
    expectTypeOf<Api["pickAt"]>().returns.toEqualTypeOf<Entity | undefined>();
  });

  it("selected() returns a readonly Entity[]", () => {
    expectTypeOf<Api["selected"]>().returns.toEqualTypeOf<readonly Entity[]>();
  });

  it("select/toggle/isSelected take a branded Entity, not a bare number", () => {
    expectTypeOf<Api["select"]>().parameter(0).toEqualTypeOf<Entity>();
    expectTypeOf<Api["toggle"]>().parameter(0).toEqualTypeOf<Entity>();
    expectTypeOf<Api["isSelected"]>().parameter(0).toEqualTypeOf<Entity>();

    expectTypeOf<Api["select"]>().parameter(0).not.toEqualTypeOf<number>();
  });

  it("enable/disable/clear take no arguments and return void", () => {
    expectTypeOf<Api["enable"]>().parameters.toEqualTypeOf<[]>();
    expectTypeOf<Api["disable"]>().parameters.toEqualTypeOf<[]>();
    expectTypeOf<Api["clear"]>().parameters.toEqualTypeOf<[]>();
    expectTypeOf<Api["enable"]>().returns.toBeVoid();
  });
});

describe("editor-selection — Events contract", () => {
  it("editor-selection:changed types its payload as { selected: readonly Entity[] }", () => {
    expectTypeOf<Events["editor-selection:changed"]>().toEqualTypeOf<{
      selected: readonly Entity[];
    }>();
  });
});

describe("editor-selection — Config contract", () => {
  it("pickLayer is a string and multiSelect is a boolean", () => {
    expectTypeOf<Config["pickLayer"]>().toBeString();
    expectTypeOf<Config["multiSelect"]>().toBeBoolean();
  });
});

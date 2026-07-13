/**
 * @file commands plugin — type-level tests.
 *
 * `EditorId` brand isolation, `Command` discriminated-union narrowing,
 * `CommandResult` narrowing on `ok`, and `commands:restored` emit typing.
 * Vitest transforms this file with esbuild (no type-checking at test-run
 * time) — the `@ts-expect-error` directives are validated by `tsc --noEmit`.
 */
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { Entity } from "../../../ecs/types";
import type { CommandsApiContext } from "../../api";
import type { Api, Command, CommandResult } from "../../types";

describe("commands types — EditorId brand", () => {
  it("an EditorId is not assignable from a plain number", () => {
    // @ts-expect-error -- a plain number literal is not an EditorId without the brand
    const id: import("../../types").EditorId = 1;
    expect(id).toBeDefined();
  });

  it("an EditorId is not assignable to/from an Entity (different brands)", () => {
    const id = 1 as import("../../types").EditorId;
    const entity = 1 as Entity;

    // @ts-expect-error -- EditorId and Entity carry different unique-symbol brands
    const wrongEntity: Entity = id;
    expect(wrongEntity).toBeDefined();

    // @ts-expect-error -- EditorId and Entity carry different unique-symbol brands
    const wrongId: import("../../types").EditorId = entity;
    expect(wrongId).toBeDefined();
  });
});

describe("commands types — Command narrows on kind", () => {
  it("a spawn command has no .field (that belongs to setField only)", () => {
    const command: Command = { kind: "spawn", components: {} };
    if (command.kind === "spawn") {
      // @ts-expect-error -- .field only exists on the { kind: "setField" } variant
      const value = command.field;
      expect(value).toBeUndefined();
    }
  });
});

describe("commands types — CommandResult narrows on ok", () => {
  it(".inverse only exists on the ok:true arm", () => {
    const result: CommandResult = { ok: false, error: "nope" };
    if (!result.ok) {
      // @ts-expect-error -- .inverse only exists when ok is true
      const inverse = result.inverse;
      expect(inverse).toBeUndefined();
    }
  });

  it("expectTypeOf: apply/resolve return the documented Api shapes", () => {
    expectTypeOf<Api["apply"]>().returns.toEqualTypeOf<CommandResult>();
    expectTypeOf<Api["resolve"]>().returns.toEqualTypeOf<Entity | undefined>();
  });
});

describe("commands types — commands:restored emit typing", () => {
  it("a valid source type-checks; an invalid one is a type error", () => {
    const emit: CommandsApiContext["emit"] = vi.fn();

    emit("commands:restored", { source: "reload" });

    // @ts-expect-error -- "nope" is not a valid RestoreSource
    emit("commands:restored", { source: "nope" });

    expect(emit).toHaveBeenCalledWith("commands:restored", { source: "reload" });
  });
});

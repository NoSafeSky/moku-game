/**
 * @file editor-history plugin — type-level tests.
 *
 * `Api` surface shape, `applyTracked`'s `Command -> CommandResult` typing, a
 * `setField` `Mutation`'s round-trip assignability, and `canUndo`/`canRedo`'s
 * `() => boolean` signature. Vitest transforms this file with esbuild (no
 * type-checking at test-run time) — `@ts-expect-error` directives are
 * validated by `tsc --noEmit`.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Command, CommandResult, EditorId } from "../../../commands/types";
import type { Api, Config, Mutation } from "../../types";

describe("editor-history types — Api surface", () => {
  it("applyTracked accepts a Command and returns CommandResult", () => {
    expectTypeOf<Api["applyTracked"]>().parameter(0).toEqualTypeOf<Command>();
    expectTypeOf<Api["applyTracked"]>().returns.toEqualTypeOf<CommandResult>();
    expect(true).toBe(true);
  });

  it("canUndo/canRedo are () => boolean", () => {
    expectTypeOf<Api["canUndo"]>().toEqualTypeOf<() => boolean>();
    expectTypeOf<Api["canRedo"]>().toEqualTypeOf<() => boolean>();
    expect(true).toBe(true);
  });

  it("beginGesture/endGesture/clear are () => void", () => {
    expectTypeOf<Api["beginGesture"]>().toEqualTypeOf<() => void>();
    expectTypeOf<Api["endGesture"]>().toEqualTypeOf<() => void>();
    expectTypeOf<Api["clear"]>().toEqualTypeOf<() => void>();
    expect(true).toBe(true);
  });

  it("Api exposes exactly the eight documented methods", () => {
    type ApiKeys = keyof Api;
    expectTypeOf<ApiKeys>().toEqualTypeOf<
      | "applyTracked"
      | "undo"
      | "redo"
      | "canUndo"
      | "canRedo"
      | "beginGesture"
      | "endGesture"
      | "clear"
    >();
    expect(true).toBe(true);
  });
});

describe("editor-history types — Mutation round-trip", () => {
  it("a setField Command's inverse is assignable back to Command", () => {
    const id = 1 as EditorId;
    const mutation: Mutation = {
      command: { kind: "setField", id, component: "Position", field: "x", value: 1 },
      inverse: { kind: "setField", id, component: "Position", field: "x", value: 0 }
    };

    const roundTrip: Command = mutation.inverse;

    expect(roundTrip.kind).toBe("setField");
  });
});

describe("editor-history types — Config", () => {
  it("maxDepth must be a number", () => {
    // @ts-expect-error -- maxDepth must be a number, not a string
    const config: Config = { maxDepth: "100" };
    expect(config).toBeDefined();
  });
});

/**
 * @file editor-bridge plugin — type-level tests.
 *
 * Compile-time-only assertions over the public `EditorSnapshot`/`Api` surface. Vitest transpiles
 * this file without type-checking at test-run time — the `@ts-expect-error` directives are
 * validated by `tsc --noEmit`.
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import type { Command, CommandResult, EditorId } from "../../../commands/types";
import type { Api, EditorSnapshot, EntitySnapshot } from "../../types";

/**
 * A never-executed compile-time contract for the `Api`/`EditorSnapshot` surface: `snapshot`/
 * `describe` reject an explicit type argument, and `EditorSnapshot["mode"]`/`selection` reject an
 * unknown mode literal / a `.push()` call (readonly). tsc type-checks the body regardless of the
 * (absent) call — mirrors `editor-runtime`'s `typeContracts`.
 *
 * @param bridge - A real `Api` instance (never invoked here — reference only).
 * @param snapshot - A real `EditorSnapshot` (never mutated here — reference only).
 * @returns The rejected `mode` value built for the check — returned so nothing is unused.
 * @example
 * ```ts
 * typeContracts(bridge, snapshot); // compile-time only
 * ```
 */
const typeContracts = (bridge: Api, snapshot: EditorSnapshot): { mode: EditorSnapshot["mode"] } => {
  // @ts-expect-error -- snapshot takes no type parameters
  bridge.snapshot<never>();
  // @ts-expect-error -- describe takes no type parameters
  bridge.describe<never>("Transform");
  // @ts-expect-error -- selection is readonly EditorId[]; push is not a member
  snapshot.selection.push({} as EditorId);

  // @ts-expect-error -- "paused" is not a valid mode
  const badMode: EditorSnapshot["mode"] = "paused";
  return { mode: badMode };
};

describe("editor-bridge types — EditorSnapshot shape", () => {
  it("has exactly epoch/entities/selection/mode/canUndo/canRedo", () => {
    expectTypeOf<EditorSnapshot>().toEqualTypeOf<{
      readonly epoch: number;
      readonly entities: readonly EntitySnapshot[];
      readonly selection: readonly EditorId[];
      readonly mode: "edit" | "play";
      readonly canUndo: boolean;
      readonly canRedo: boolean;
    }>();
  });
});

describe("editor-bridge types — Api method shapes", () => {
  it("apply takes a Command and returns a CommandResult", () => {
    expectTypeOf<Api["apply"]>().parameter(0).toEqualTypeOf<Command>();
    expectTypeOf<Api["apply"]>().returns.toEqualTypeOf<CommandResult>();
  });

  it("setField takes (id, component, field, value) and returns a CommandResult", () => {
    expectTypeOf<Api["setField"]>().parameter(0).toEqualTypeOf<EditorId>();
    expectTypeOf<Api["setField"]>().returns.toEqualTypeOf<CommandResult>();
  });
});

describe("editor-bridge — compile-time rejections", () => {
  it("rejects explicit type args, a readonly-array push, and an unknown mode literal", () => {
    expect(typeof typeContracts).toBe("function");
  });
});

/**
 * @file editor-runtime plugin — type-level contracts.
 *
 * Compile-time assertions over the public `Api` surface, `Config`, and `Events`: `mode()` returns
 * the `Mode` union, `step()` returns `loop`'s `TimeStepResult`, `config.editStages` is a
 * `readonly Stage[]` that rejects an unknown stage literal, and `emit` accepts the declared
 * `editor-runtime:modeChanged` payload while rejecting a malformed one. Mirrors the sibling
 * `camera` plugin's `types.test.ts` (one type test per API return type + config/event field).
 */
import type { EmitFn } from "@moku-labs/core";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { TimeStepResult } from "../../../loop/types";
import type { Stage } from "../../../scheduler/types";
import type { Api, Config, Events, Mode } from "../../types";

/**
 * A never-executed compile-time contract: `Config.editStages` rejects an unknown stage literal,
 * and `emit` rejects a malformed `modeChanged` payload. tsc type-checks the body regardless of
 * the (absent) call, and the `@ts-expect-error` lines fail the build if a rejection stops
 * holding. Returns the built values so nothing is unused.
 *
 * @param emit - The editor-runtime `emit` surface (never invoked at runtime).
 * @returns The two `Config` objects built for the type check.
 * @example
 * ```ts
 * typeContracts(app.emit); // compile-time only
 * ```
 */
const typeContracts = (emit: EmitFn<Events>): readonly Config[] => {
  emit("editor-runtime:modeChanged", { mode: "play" }); // ok — declared payload
  // @ts-expect-error — "paused" is not a valid Mode.
  emit("editor-runtime:modeChanged", { mode: "paused" });

  const ok: Config = { editStages: ["input", "sync", "render"] };
  const bad: Config = {
    // @ts-expect-error — "frobnicate" is not a valid Stage.
    editStages: ["frobnicate"]
  };
  return [ok, bad];
};

describe("editor-runtime Api — return-type contracts", () => {
  it("mode() returns the Mode union", () => {
    expectTypeOf<Api["mode"]>().returns.toEqualTypeOf<Mode>();
  });

  it("step() returns loop's TimeStepResult", () => {
    expectTypeOf<Api["step"]>().returns.toEqualTypeOf<TimeStepResult>();
  });

  it("isPlaying() returns boolean", () => {
    expectTypeOf<Api["isPlaying"]>().returns.toEqualTypeOf<boolean>();
  });

  it("the mutators return void", () => {
    expectTypeOf<Api["enterEdit"]>().returns.toEqualTypeOf<void>();
    expectTypeOf<Api["enterPlay"]>().returns.toEqualTypeOf<void>();
    expectTypeOf<Api["stop"]>().returns.toEqualTypeOf<void>();
  });
});

describe("editor-runtime Config — editStages is a readonly Stage[]", () => {
  it("accepts the default stage tuple", () => {
    expectTypeOf<Config["editStages"]>().toEqualTypeOf<readonly Stage[]>();
  });
});

describe("editor-runtime — compile-time rejections", () => {
  it("rejects an unknown stage literal and a malformed modeChanged payload", () => {
    expect(typeof typeContracts).toBe("function");
  });
});

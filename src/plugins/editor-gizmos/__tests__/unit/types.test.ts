/**
 * @file editor-gizmos plugin — type-level tests (`Api`/`GizmoMode`/`GizmoAxis`/`GizmoSpace`/
 * `GizmoPivot`/`GestureSink`).
 *
 * The `@ts-expect-error` rejections live inside a NEVER-INVOKED function body (the
 * `camera`/`ui` `types.test.ts` precedent) — tsc still type-checks the body, but nothing
 * dereferences a property off `undefined` at runtime.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Command } from "../../../commands/types";
import type { Api, GestureSink, GizmoAxis, GizmoMode, GizmoPivot, GizmoSpace } from "../../types";

/**
 * A never-executed compile-time contract: `setMode` rejects an invalid `GizmoMode`,
 * `setSpace`/`setPivot` reject a non-member literal, and `GestureSink.applyTracked` rejects a
 * non-`Command`. tsc type-checks this body regardless of the (absent) call; the
 * `@ts-expect-error` lines fail the build if the rejection ever stops holding.
 *
 * @param api - The editor-gizmos API surface (never invoked at runtime).
 * @param sink - A gesture sink (never invoked at runtime).
 * @example
 * ```ts
 * typeContracts(app["editor-gizmos"], sink); // compile-time only
 * ```
 */
const typeContracts = (api: Api, sink: GestureSink): void => {
  api.setMode("translate"); // ok
  api.setMode("rotate"); // ok
  api.setMode("scale"); // ok
  api.setMode("rect"); // ok
  // @ts-expect-error — "spin" is not a valid GizmoMode
  api.setMode("spin");

  api.setSpace("local"); // ok
  api.setSpace("global"); // ok
  // @ts-expect-error — "world" is not a valid GizmoSpace
  api.setSpace("world");

  api.setPivot("pivot"); // ok
  api.setPivot("center"); // ok
  // @ts-expect-error — "origin" is not a valid GizmoPivot
  api.setPivot("origin");

  sink.applyTracked({
    kind: "setField",
    id: 1 as never,
    component: "Transform",
    field: "x",
    value: 1
  }); // ok
  // @ts-expect-error — a bare string is not a Command
  sink.applyTracked("not-a-command");
};

it("GizmoMode is exactly the translate/rotate/scale/rect union", () => {
  expectTypeOf<GizmoMode>().toEqualTypeOf<"translate" | "rotate" | "scale" | "rect">();
});

it("GizmoAxis is exactly the x/y/xy union", () => {
  expectTypeOf<GizmoAxis>().toEqualTypeOf<"x" | "y" | "xy">();
});

it("GizmoSpace is exactly the local/global union", () => {
  expectTypeOf<GizmoSpace>().toEqualTypeOf<"local" | "global">();
});

it("GizmoPivot is exactly the pivot/center union", () => {
  expectTypeOf<GizmoPivot>().toEqualTypeOf<"pivot" | "center">();
});

it("Api.mode() returns a GizmoMode", () => {
  expectTypeOf<Api["mode"]>().returns.toEqualTypeOf<GizmoMode>();
});

it("Api.setMode accepts a GizmoMode parameter", () => {
  expectTypeOf<Api["setMode"]>().parameter(0).toEqualTypeOf<GizmoMode>();
});

it("Api.space()/setSpace round-trip a GizmoSpace", () => {
  expectTypeOf<Api["space"]>().returns.toEqualTypeOf<GizmoSpace>();
  expectTypeOf<Api["setSpace"]>().parameter(0).toEqualTypeOf<GizmoSpace>();
});

it("Api.pivot()/setPivot round-trip a GizmoPivot", () => {
  expectTypeOf<Api["pivot"]>().returns.toEqualTypeOf<GizmoPivot>();
  expectTypeOf<Api["setPivot"]>().parameter(0).toEqualTypeOf<GizmoPivot>();
});

it("GestureSink.applyTracked accepts a Command parameter", () => {
  expectTypeOf<GestureSink["applyTracked"]>().parameter(0).toEqualTypeOf<Command>();
});

it("Api exposes exactly the ten control methods — no Pixi type leaks", () => {
  type ApiKeys = keyof Api;
  expectTypeOf<ApiKeys>().toEqualTypeOf<
    | "enable"
    | "disable"
    | "setMode"
    | "setSnap"
    | "mode"
    | "setSpace"
    | "setPivot"
    | "space"
    | "pivot"
    | "setGestureSink"
  >();
});

describe("editor-gizmos — compile-time rejections", () => {
  it("rejects an invalid GizmoMode/GizmoSpace/GizmoPivot and a non-Command applyTracked argument", () => {
    expect(typeof typeContracts).toBe("function");
  });
});

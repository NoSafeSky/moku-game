/**
 * @file camera plugin — type-level contracts.
 *
 * Compile-time assertions over the public `Api` surface + `Config`: the animated
 * methods return a `TweenHandle`, the readers return the documented shapes, the layer
 * handles are `Container | undefined`, `follow` takes a structural `FollowTarget`, and
 * malformed follow targets / config fields are rejected. Mirrors the sibling `ui`
 * plugin's `types.test.ts` (one type test per API return type + config field).
 */
import type { Container } from "pixi.js";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { TweenHandle } from "../../../tween/types";
import type { Api, Config, FollowTarget, Point } from "../../types";

/**
 * A never-executed compile-time contract: `follow` accepts a structural point and
 * rejects a wrong-typed field; `Config` rejects a wrong-typed field. tsc type-checks
 * the body regardless of the (absent) call, and the two `@ts-expect-error` lines fail
 * the build if the rejection ever stops holding. Returns the built configs so nothing
 * is unused.
 *
 * @param api - The camera API surface (never invoked at runtime).
 * @returns The two `Config` objects built for the type check.
 * @example
 * ```ts
 * typeContracts(app.camera); // compile-time only
 * ```
 */
const typeContracts = (api: Api): readonly Config[] => {
  api.follow({ x: 0, y: 0 }); // ok — structural point
  // @ts-expect-error — x must be a number, not a string.
  api.follow({ x: "0", y: 0 });

  const ok: Config = {
    zoom: 1,
    minZoom: 0.1,
    maxZoom: 10,
    followLerp: 0.15,
    width: 800,
    height: 600,
    updateStage: "sync"
  };
  const bad: Config = {
    // @ts-expect-error — zoom must be a number, not a string.
    zoom: "1",
    minZoom: 0.1,
    maxZoom: 10,
    followLerp: 0.15,
    width: 800,
    height: 600,
    updateStage: "sync"
  };
  return [ok, bad];
};

describe("camera Api — return-type contracts", () => {
  it("animated methods return a TweenHandle", () => {
    expectTypeOf<Api["moveTo"]>().returns.toEqualTypeOf<TweenHandle>();
    expectTypeOf<Api["zoomTo"]>().returns.toEqualTypeOf<TweenHandle>();
    expectTypeOf<Api["rotateTo"]>().returns.toEqualTypeOf<TweenHandle>();
  });

  it("readers return their documented shapes", () => {
    expectTypeOf<Api["getPosition"]>().returns.toEqualTypeOf<Point>();
    expectTypeOf<Api["getZoom"]>().returns.toEqualTypeOf<number>();
    expectTypeOf<Api["getRotation"]>().returns.toEqualTypeOf<number>();
    expectTypeOf<Api["screenToWorld"]>().returns.toEqualTypeOf<Point>();
  });

  it("layer handles are Container | undefined", () => {
    expectTypeOf<Api["world"]>().toEqualTypeOf<Container | undefined>();
    expectTypeOf<Api["addLayer"]>().returns.toEqualTypeOf<Container | undefined>();
    expectTypeOf<Api["layer"]>().returns.toEqualTypeOf<Container | undefined>();
  });

  it("follow takes an optional structural FollowTarget", () => {
    expectTypeOf<Api["follow"]>().parameter(0).toEqualTypeOf<FollowTarget | undefined>();
  });
});

describe("camera — compile-time rejections", () => {
  it("rejects a malformed FollowTarget and a wrong-typed Config field", () => {
    expect(typeof typeContracts).toBe("function");
  });
});

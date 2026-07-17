/**
 * @file graphics-2d plugin — type-level contracts.
 *
 * A regular `*.test.ts` (not `*.test-d.ts`) so it BOTH executes under vitest and is type-checked by
 * `tsc --noEmit` — `vitest.config.ts` includes only `*.test.ts`, so a `.test-d.ts` here would never
 * run. Mirrors the sibling `camera` plugin's `types.test.ts`.
 *
 * Covers: the two component value shapes carry exactly the contract fields with the right value
 * types; the public `Api` is the two component tokens and nothing else; `Config` is closed empty;
 * and no Pixi type reaches the public surface — the render seam is the plain-data `RenderSurface`.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Component } from "../../../ecs/types";
import type { PrimitiveSpec, SpriteSpec } from "../../../renderer/types";
import type {
  Api,
  Config,
  RenderableKind,
  RenderSurface,
  ShapeValue,
  SpriteRendererValue,
  State,
  TrackedView
} from "../../types";

/**
 * A never-executed compile-time contract: the two value types accept their documented shapes and
 * reject wrong-typed / unknown fields. tsc type-checks the body regardless of the (absent) call,
 * so each `@ts-expect-error` fails the build if its rejection ever stops holding.
 *
 * @returns The values built for the type check, so nothing is unused.
 * @example
 * ```ts
 * typeContracts(); // compile-time only
 * ```
 */
const typeContracts = (): readonly object[] => {
  const sprite: SpriteRendererValue = {
    sprite: "ship",
    tint: "#ffffff",
    flipX: false,
    sortingLayer: "Default",
    orderInLayer: 0
  };
  const badSprite: SpriteRendererValue = {
    // @ts-expect-error — sprite is an asset alias string, not a number.
    sprite: 7,
    tint: "#ffffff",
    flipX: false,
    sortingLayer: "Default",
    orderInLayer: 0
  };
  const shape: ShapeValue = {
    kind: "circle",
    width: 100,
    height: 100,
    radius: 50,
    fill: "#cccccc",
    stroke: "#000000",
    strokeWidth: 0
  };
  const badShape: ShapeValue = {
    // @ts-expect-error — kind is the closed union "rect" | "circle"; "triangle" is not a member.
    kind: "triangle",
    width: 100,
    height: 100,
    radius: 50,
    fill: "#cccccc",
    stroke: "#000000",
    strokeWidth: 0
  };
  // @ts-expect-error — Config is closed and empty: no knobs may be added.
  const badConfig: Config = { antialias: true };

  return [sprite, badSprite, shape, badShape, badConfig];
};

describe("graphics-2d value types", () => {
  it("types SpriteRendererValue with exactly the contract fields", () => {
    expectTypeOf<keyof SpriteRendererValue>().toEqualTypeOf<
      "sprite" | "tint" | "flipX" | "sortingLayer" | "orderInLayer"
    >();
    expectTypeOf<SpriteRendererValue["sprite"]>().toEqualTypeOf<string>();
    expectTypeOf<SpriteRendererValue["tint"]>().toEqualTypeOf<string>();
    expectTypeOf<SpriteRendererValue["flipX"]>().toEqualTypeOf<boolean>();
    expectTypeOf<SpriteRendererValue["sortingLayer"]>().toEqualTypeOf<string>();
    expectTypeOf<SpriteRendererValue["orderInLayer"]>().toEqualTypeOf<number>();
  });

  it("types ShapeValue with exactly the contract fields and a closed kind union", () => {
    expectTypeOf<keyof ShapeValue>().toEqualTypeOf<
      "kind" | "width" | "height" | "radius" | "fill" | "stroke" | "strokeWidth"
    >();
    expectTypeOf<ShapeValue["kind"]>().toEqualTypeOf<"rect" | "circle">();
    expectTypeOf<ShapeValue["width"]>().toEqualTypeOf<number>();
    expectTypeOf<ShapeValue["height"]>().toEqualTypeOf<number>();
    expectTypeOf<ShapeValue["radius"]>().toEqualTypeOf<number>();
    expectTypeOf<ShapeValue["fill"]>().toEqualTypeOf<string>();
    expectTypeOf<ShapeValue["stroke"]>().toEqualTypeOf<string>();
    expectTypeOf<ShapeValue["strokeWidth"]>().toEqualTypeOf<number>();
  });
});

describe("graphics-2d Api surface", () => {
  it("exposes exactly the two component-token getters", () => {
    expectTypeOf<keyof Api>().toEqualTypeOf<"SpriteRenderer" | "Shape">();
  });

  it("types the tokens over their component value types", () => {
    expectTypeOf<Api["SpriteRenderer"]>().toEqualTypeOf<Component<SpriteRendererValue>>();
    expectTypeOf<Api["Shape"]>().toEqualTypeOf<Component<ShapeValue>>();
  });

  it("keeps every Api member a plain ecs token — no Pixi type reaches the surface", () => {
    expectTypeOf<Api[keyof Api]>().toEqualTypeOf<
      Component<SpriteRendererValue> | Component<ShapeValue>
    >();
  });
});

describe("graphics-2d Config", () => {
  it("is the closed empty record (no tunable knobs)", () => {
    expectTypeOf<Config>().toEqualTypeOf<Record<string, never>>();
  });
});

describe("graphics-2d State", () => {
  it("types the tokens as optional until onStart defines them", () => {
    expectTypeOf<State["spriteToken"]>().toEqualTypeOf<
      Component<SpriteRendererValue> | undefined
    >();
    expectTypeOf<State["shapeToken"]>().toEqualTypeOf<Component<ShapeValue> | undefined>();
  });

  it("tracks one view per entity, keyed by the renderable kind plus a signature", () => {
    expectTypeOf<RenderableKind>().toEqualTypeOf<"shape" | "sprite">();
    expectTypeOf<TrackedView["kind"]>().toEqualTypeOf<RenderableKind>();
    expectTypeOf<TrackedView["sig"]>().toEqualTypeOf<string>();
    expectTypeOf<State["lastEpoch"]>().toEqualTypeOf<number>();
  });
});

describe("graphics-2d RenderSurface", () => {
  it("is the plain-data renderer seam — attach specs carry no Pixi type", () => {
    expectTypeOf<RenderSurface["attachPrimitive"]>().parameter(1).toEqualTypeOf<PrimitiveSpec>();
    expectTypeOf<RenderSurface["attachSprite"]>().parameter(1).toEqualTypeOf<SpriteSpec>();
    expectTypeOf<RenderSurface["attachPrimitive"]>().returns.toEqualTypeOf<boolean>();
    expectTypeOf<RenderSurface["detach"]>().returns.toEqualTypeOf<void>();
    expectTypeOf<RenderSurface["markDirty"]>().returns.toEqualTypeOf<void>();
  });
});

describe("graphics-2d — compile-time rejections", () => {
  it("rejects wrong-typed component values and any added Config knob", () => {
    expect(typeof typeContracts).toBe("function");
  });
});

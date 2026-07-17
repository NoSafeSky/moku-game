/**
 * @file graphics-2d plugin — API factory (the two component-token getters).
 *
 * The API is available immediately, but both token getters guard until `onStart` has defined the
 * component on the ecs world (the `renderer.Transform` precedent, spec/11 §2.8): reading either
 * before start throws an actionable `[game] …` error rather than minting a second token that would
 * diverge from the one the render-sync system queries.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Component } from "../../../ecs/types";
import type { GraphicsApiContext } from "../../api";
import { createApi } from "../../api";
import { createState } from "../../state";
import type { ShapeValue, SpriteRendererValue } from "../../types";

/** A stub component token of the same shape `onStart` stores on state. */
const makeToken = <T>(id: number): Component<T> =>
  ({ __id: id, __value: {} }) as unknown as Component<T>;

/** Build the minimal structural context `createApi` reads (state only — no require, no log). */
const createMockCtx = (): GraphicsApiContext => ({
  state: createState({ global: {}, config: {} })
});

describe("createApi — SpriteRenderer", () => {
  it("throws before start, when onStart has not defined the token", () => {
    const api = createApi(createMockCtx());

    expect(() => api.SpriteRenderer).toThrow(/accessed before start/);
  });

  it("names the plugin and the actionable fix in the before-start error", () => {
    const api = createApi(createMockCtx());

    expect(() => api.SpriteRenderer).toThrow(
      '[game] graphics-2d.SpriteRenderer accessed before start.\n  Call app.start() before using app["graphics-2d"].SpriteRenderer.'
    );
  });

  it("returns the exact token instance onStart stored on state", () => {
    const ctx = createMockCtx();
    const token = makeToken<SpriteRendererValue>(1);
    ctx.state.spriteToken = token;
    const api = createApi(ctx);

    expect(api.SpriteRenderer).toBe(token);
  });

  it("returns the same token instance on repeat access", () => {
    const ctx = createMockCtx();
    ctx.state.spriteToken = makeToken<SpriteRendererValue>(1);
    const api = createApi(ctx);

    expect(api.SpriteRenderer).toBe(api.SpriteRenderer);
  });
});

describe("createApi — Shape", () => {
  it("throws before start, when onStart has not defined the token", () => {
    const api = createApi(createMockCtx());

    expect(() => api.Shape).toThrow(/accessed before start/);
  });

  it("names the plugin and the actionable fix in the before-start error", () => {
    const api = createApi(createMockCtx());

    expect(() => api.Shape).toThrow(
      '[game] graphics-2d.Shape accessed before start.\n  Call app.start() before using app["graphics-2d"].Shape.'
    );
  });

  it("returns the exact token instance onStart stored on state", () => {
    const ctx = createMockCtx();
    const token = makeToken<ShapeValue>(2);
    ctx.state.shapeToken = token;
    const api = createApi(ctx);

    expect(api.Shape).toBe(token);
  });

  it("guards each token independently", () => {
    const ctx = createMockCtx();
    ctx.state.shapeToken = makeToken<ShapeValue>(2);
    const api = createApi(ctx);

    expect(() => api.Shape).not.toThrow();
    expect(() => api.SpriteRenderer).toThrow(/accessed before start/);
  });
});

describe("createApi — surface", () => {
  it("exposes exactly the two token getters and nothing else", () => {
    const ctx = createMockCtx();
    ctx.state.spriteToken = makeToken<SpriteRendererValue>(1);
    ctx.state.shapeToken = makeToken<ShapeValue>(2);

    expect(Object.keys(createApi(ctx)).toSorted()).toEqual(["Shape", "SpriteRenderer"]);
  });

  it("types the getters as their component tokens", () => {
    const ctx = createMockCtx();
    ctx.state.spriteToken = makeToken<SpriteRendererValue>(1);
    ctx.state.shapeToken = makeToken<ShapeValue>(2);
    const api = createApi(ctx);

    expectTypeOf(api.SpriteRenderer).toEqualTypeOf<Component<SpriteRendererValue>>();
    expectTypeOf(api.Shape).toEqualTypeOf<Component<ShapeValue>>();
  });
});

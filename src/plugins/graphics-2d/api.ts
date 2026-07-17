/**
 * @file graphics-2d plugin — API factory (the two component-token getters).
 *
 * The tokens live in `ctx.state`, written by `onStart` via `world.defineComponent`, so the getters,
 * the render-sync system, and consumers all share ONE token instance per component. Reading a
 * getter before start throws rather than minting a token that would diverge from the one the
 * reconciler queries — the `renderer.Transform` precedent (spec/11 §2.8).
 */
import type { Component } from "../ecs/types";
import type { Api, ShapeValue, SpriteRendererValue, State } from "./types";

/**
 * Structural context required by {@link createApi} — only what the getters read, so a unit test
 * supplies `{ state }` and nothing else. The API needs neither `require` nor `log`.
 */
export type GraphicsApiContext = {
  /** graphics-2d plugin state — the token slots `onStart` fills. */
  readonly state: State;
};

/**
 * Returns a component token, or throws an actionable error when `onStart` has not defined it yet.
 *
 * Shared by both getters so the before-start contract has exactly one implementation. The generic
 * is an ordinary internal function generic — it is not a type parameter on `createPlugin` or on any
 * public API member (spec/09 §1 bans generics on the factory and the public surface, not on private
 * helpers).
 *
 * @param token - The token slot read from state (`undefined` before `onStart`).
 * @param name - The component name, for the error message.
 * @returns The component token.
 * @throws {Error} When the token is read before `app.start()` has defined it.
 * @example
 * ```ts
 * requireToken(ctx.state.shapeToken, "Shape");
 * ```
 */
const requireToken = <T>(token: Component<T> | undefined, name: string): Component<T> => {
  if (!token) {
    throw new Error(
      `[game] graphics-2d.${name} accessed before start.\n  Call app.start() before using app["graphics-2d"].${name}.`
    );
  }
  return token;
};

/**
 * Creates the graphics-2d API surface: the SpriteRenderer and Shape component tokens.
 *
 * Both are getters (not eager reads) so the API object can be built at init, before `onStart` has
 * defined either component — each throws only if actually read too early.
 *
 * @param ctx - Structural context supplying the plugin state.
 * @param ctx.state - graphics-2d state holding the two token slots.
 * @returns The graphics-2d API object.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * world.spawn(renderer.Transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }), api.Shape(createShape()));
 * ```
 */
export const createApi = (ctx: GraphicsApiContext): Api => ({
  /**
   * The SpriteRenderer component token defined on the ecs world by `onStart`. Adding it to an
   * entity is what makes that entity render a textured sprite.
   *
   * @returns The SpriteRenderer component token.
   * @throws {Error} When read before `app.start()`.
   * @example
   * ```ts
   * world.add(entity, api.SpriteRenderer, { sprite: "ship" });
   * ```
   */
  get SpriteRenderer(): Component<SpriteRendererValue> {
    return requireToken(ctx.state.spriteToken, "SpriteRenderer");
  },

  /**
   * The Shape component token defined on the ecs world by `onStart`. Adding it to an entity is what
   * makes that entity render a vector primitive.
   *
   * @returns The Shape component token.
   * @throws {Error} When read before `app.start()`.
   * @example
   * ```ts
   * world.add(entity, api.Shape, { kind: "circle", radius: 8 });
   * ```
   */
  get Shape(): Component<ShapeValue> {
    return requireToken(ctx.state.shapeToken, "Shape");
  }
});

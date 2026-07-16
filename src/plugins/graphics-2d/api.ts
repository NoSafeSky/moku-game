/**
 * @file graphics-2d plugin — API factory skeleton.
 *
 * Skeleton stub: the F3 build wave implements the two token getters, each throwing before
 * `onStart` has defined its component (the `renderer.Transform` precedent).
 */
import type { Api } from "./types";

/**
 * Creates the graphics-2d API surface (the SpriteRenderer + Shape token getters, throw before start).
 *
 * @param _ctx - Plugin context (unused in skeleton; F3 captures `state` from it).
 * @throws {Error} Always — this is a skeleton stub, implemented by the F3 build wave.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * ```
 */
export function createApi(_ctx: unknown): Api {
  throw new Error("not implemented");
}

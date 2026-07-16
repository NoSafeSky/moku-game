/**
 * @file component-registry plugin — API factory skeleton.
 *
 * Skeleton stub: the F2 build wave implements register / list / byCategory / get / has over the
 * `state.catalog` map (insertion-ordered, last-write-wins with a `ctx.log.warn` on replacement).
 */
import type { Api } from "./types";

/**
 * Creates the component-registry API surface (register / list / byCategory / get / has).
 *
 * @param _ctx - Plugin context (unused in skeleton; F2 captures `state` + `log` from it).
 * @throws {Error} Always — this is a skeleton stub, implemented by the F2 build wave.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * ```
 */
export function createApi(_ctx: unknown): Api {
  throw new Error("not implemented");
}

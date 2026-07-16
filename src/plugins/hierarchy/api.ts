/**
 * @file hierarchy plugin — API factory skeleton.
 *
 * Skeleton stub: the F2 build wave implements the Node token getter plus the read/math surface
 * (worldOf / parentOf / childrenOf / roots / depth / canReparent / computeLocalForPreserveWorld /
 * orderBetween) over the captured ecs world and `./transform` math.
 */
import type { Api } from "./types";

/**
 * Creates the hierarchy API surface (Node token getter + worldOf / childrenOf / canReparent / …).
 *
 * @param _ctx - Plugin context (unused in skeleton; F2 captures `state` + `config` + deps from it).
 * @throws {Error} Always — this is a skeleton stub, implemented by the F2 build wave.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * ```
 */
export function createApi(_ctx: unknown): Api {
  throw new Error("not implemented");
}

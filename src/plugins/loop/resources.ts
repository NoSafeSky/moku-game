/**
 * @file loop plugin — well-known resource tokens (fixed keys, valid before start).
 */
import type { Resource } from "../ecs/types";
import type { TimeState } from "./types";

/**
 * Well-known token: the frame clock, bound and updated by the loop.
 *
 * Systems read `world.resource(Time)` to access the current `dt`, `elapsed`,
 * and `frame` for the step they are executing. The loop mutates this object
 * in place once per fixed step — no per-step `setResource` allocation.
 *
 * @example
 * ```ts
 * import { Time } from "../loop/resources";
 * world.resource(Time); // → { dt: 1/60, elapsed: 0.016, frame: 1 }
 * ```
 */
export const Time: Resource<TimeState> = { __key: "loop:time" };

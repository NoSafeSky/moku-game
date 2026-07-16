/**
 * @file hierarchy plugin — the sync-stage world-transform system factory (skeleton).
 *
 * Orphan until F2: `lifecycle.start` registers the returned System on the ecs world's "sync"
 * stage once the Node token exists.
 */
import type { System } from "../ecs/types";

/**
 * Builds the sync-stage world-transform system: recomputes affected entities' world transforms
 * (epoch-gated in edit, unconditional in play) and drives renderer markDirty / setEntityVisible.
 *
 * @param _ctx - Captured deps (world / renderer / commands + state), unused in skeleton.
 * @throws {Error} Always — this is a skeleton stub, implemented by the F2 build wave.
 * @example
 * ```ts
 * world.addSystem("sync", createWorldTransformSystem(ctx));
 * ```
 */
export function createWorldTransformSystem(_ctx: unknown): System {
  throw new Error("not implemented");
}

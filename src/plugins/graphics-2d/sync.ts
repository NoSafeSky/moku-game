/**
 * @file graphics-2d plugin — the sync-stage render-sync system factory (skeleton).
 *
 * Orphan until F3: `lifecycle.start` registers the returned System on the ecs world's "sync" stage,
 * after hierarchy's world-transform system.
 */
import type { System } from "../ecs/types";

/**
 * Builds the changeEpoch-gated render-sync system: reconciles each entity's Shape / SpriteRenderer
 * component into a Pixi view via renderer.attachPrimitive / attachSprite / detach / markDirty.
 *
 * @param _ctx - Captured deps (state / renderer / world), unused in skeleton.
 * @throws {Error} Always — this is a skeleton stub, implemented by the F3 build wave.
 * @example
 * ```ts
 * world.addSystem("sync", createRenderSyncSystem(ctx));
 * ```
 */
export function createRenderSyncSystem(_ctx: unknown): System {
  throw new Error("not implemented");
}

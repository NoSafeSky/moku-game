/**
 * @file renderer plugin — transform → Pixi sync stage system.
 */
import type { System } from "../ecs/types";

/**
 * Creates the sync-stage system that repositions Pixi display objects from Transform values.
 *
 * @param _ctx - Plugin context (state, config, require).
 * @example
 * ```ts
 * world.addSystem("sync", createSyncSystem(ctx));
 * ```
 */
export function createSyncSystem(_ctx: unknown): System {
  throw new Error("not implemented");
}

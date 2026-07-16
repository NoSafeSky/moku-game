/**
 * @file renderer plugin — transform-to-Pixi sync stage system.
 *
 * Registered in the "sync" stage by onStart. Each tick it:
 *   1. Repositions every Container whose entity is in state.dirty from its
 *      Transform component value, then clears dirty.
 *   2. Despawn-reconciles: any Container whose entity is no longer alive is
 *      disposed and removed from state.views.
 */
import type { Component, Entity, System, World } from "../ecs/types";
import type { State, TransformValue } from "./types";

/**
 * Structural context type required by createSyncSystem.
 *
 * Only the fields the sync system actually accesses are included so unit tests
 * can supply a minimal stub without wiring the full kernel.
 */
export type SyncContext = {
  /** Renderer plugin state (views map and dirty set). */
  readonly state: State;
  /** The Transform component token defined in onStart. */
  readonly transformToken: Component<TransformValue>;
  /** The ECS world (used for isAlive + get). */
  readonly world: World;
};

/**
 * Creates the sync-stage system that mirrors ECS Transform data into Pixi
 * Container properties and reconciles dead-entity views.
 *
 * @param ctx - Sync context supplying state, the Transform token, and the world.
 * @param ctx.state - Renderer plugin state containing views and dirty set.
 * @param ctx.transformToken - The Transform component token for world.get calls.
 * @param ctx.world - The ECS world for liveness checks and component reads.
 * @returns A System function `(world, dt) => void` suitable for world.addSystem.
 * @example
 * ```ts
 * const syncSystem = createSyncSystem({ state, transformToken, world });
 * world.addSystem("sync", syncSystem);
 * ```
 */
export const createSyncSystem = (ctx: SyncContext): System => {
  /**
   * Reposition a single container from its entity's transform.
   *
   * Phase-1: sources the value from `state.worldResolver` (WORLD space) when one is
   * injected, falling back to the local Transform component otherwise. With no
   * resolver set (every non-editor / flat app) this fallback is byte-identical to
   * the pre-Phase-1 behavior — the hierarchy plugin injects the resolver so parented
   * entities position from their world transform instead.
   *
   * @param entity - The entity whose transform to read.
   * @example
   * ```ts
   * repositionFromTransform(entity); // reads world/local transform, sets container position
   * ```
   */
  const repositionFromTransform = (entity: Entity): void => {
    const container = ctx.state.views.get(entity);
    if (!container) return;

    const transform =
      ctx.state.worldResolver?.(entity) ?? ctx.world.get(entity, ctx.transformToken);
    if (!transform) return;

    container.position.set(transform.x, transform.y);
    container.rotation = transform.rotation;
    container.scale.set(transform.scaleX, transform.scaleY);
  };

  /**
   * Dispose and remove the view for a dead entity.
   *
   * @param entity - The entity to reconcile.
   * @example
   * ```ts
   * reconcileDead(entity); // destroys container, removes from views map
   * ```
   */
  const reconcileDead = (entity: Entity): void => {
    const container = ctx.state.views.get(entity);
    if (!container) return;
    container.destroy();
    ctx.state.views.delete(entity);
  };

  return (_world: World, _dt: number): void => {
    // Phase 1 — reposition dirty entities
    for (const entity of ctx.state.dirty) {
      repositionFromTransform(entity);
    }
    ctx.state.dirty.clear();

    // Phase 2 — despawn reconciliation (diff views against liveness)
    for (const entity of ctx.state.views.keys()) {
      if (!ctx.world.isAlive(entity)) {
        reconcileDead(entity);
      }
    }
  };
};

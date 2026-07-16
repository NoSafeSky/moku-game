/**
 * @file hierarchy plugin — the sync-stage world-transform system.
 *
 * Registered by `lifecycle.start` on the ecs world's "sync" stage. Its job is narrower than the
 * name suggests: the renderer's OWN sync system positions views in world space by pulling through
 * the injected `WorldTransformResolver` (see `lifecycle.ts` / `api.ts`'s `composeWorldOf`) — this
 * system instead identifies the AFFECTED set of Node-carrying entities each tick and, per entity,
 * calls `renderer.markDirty` (so the renderer repositions it) and `renderer.setEntityVisible`
 * with the propagated `effectiveEnabled` flag (`Node.enabled` AND every ancestor's `enabled`).
 *
 * Edit mode (`world.activeStages()` returns a gated list) recomputes only when
 * `world.changeEpoch()` has advanced since the last tick — no write, no work. Play mode
 * (`activeStages() === undefined`) recomputes unconditionally every tick (the Unity-DOTS-validated
 * choice — gameplay can move transforms without bumping structural epoch in a way the gate could
 * rely on).
 */
import type { Api as CommandsApi } from "../commands/types";
import type { Component, Entity, System, World } from "../ecs/types";
import type { Api as RendererApi } from "../renderer/types";
import type { NodeValue } from "./types";

/**
 * Structural context required by {@link createWorldTransformSystem} — the deps `lifecycle.start`
 * captures once (a tight closure with no per-tick `ctx.require`).
 */
export type WorldTransformSystemContext = {
  /** The renderer API — `markDirty` + `setEntityVisible` are called per affected entity. */
  readonly renderer: RendererApi;
  /** The commands API — `resolve` translates a `Node.parent` EditorId to a live Entity. */
  readonly commands: CommandsApi;
  /** The Node component token defined by `onStart`. */
  readonly nodeToken: Component<NodeValue>;
  /** The configured ancestor-walk depth cap (defensive against a dangling cycle). */
  readonly maxDepth: number;
};

/**
 * Builds the sync-stage world-transform system.
 *
 * @param ctx - Captured deps (renderer/commands/nodeToken/maxDepth).
 * @returns A `System` `(world, dt) => void` suitable for `world.addSystem("sync", ...)`.
 * @example
 * ```ts
 * world.addSystem("sync", createWorldTransformSystem({ renderer, commands, nodeToken, maxDepth }));
 * ```
 */
export function createWorldTransformSystem(ctx: WorldTransformSystemContext): System {
  /** The `world.changeEpoch()` value the last edit-mode recompute ran at. */
  let lastEpoch: number | undefined;

  /**
   * Whether `entity` is effectively enabled: its own `Node.enabled` AND every ancestor's
   * `enabled`, walking `Node.parent` upward and root-healing an unresolvable parent (treated as
   * "no further ancestor to disable it").
   *
   * @param world - The ECS world (for `get` reads of Node).
   * @param entity - The entity to evaluate.
   * @returns `true` when the entity and every ancestor are enabled.
   * @example
   * ```ts
   * renderer.setEntityVisible(entity, isEffectivelyEnabled(world, entity));
   * ```
   */
  const isEffectivelyEnabled = (world: World, entity: Entity): boolean => {
    let current: Entity | undefined = entity;
    let hops = 0;
    while (current !== undefined && hops <= ctx.maxDepth) {
      const node = world.get(current, ctx.nodeToken);
      if (!node) return true;
      if (!node.enabled) return false;
      if (node.parent === undefined) return true;
      current = ctx.commands.resolve(node.parent);
      hops++;
    }
    return true;
  };

  return (world: World, _dt: number): void => {
    const editing = world.activeStages() !== undefined;
    if (editing) {
      const epoch = world.changeEpoch();
      if (epoch === lastEpoch) return;
      lastEpoch = epoch;
    }

    for (const entity of world.query(ctx.nodeToken)) {
      ctx.renderer.markDirty(entity);
      ctx.renderer.setEntityVisible(entity, isEffectivelyEnabled(world, entity));
    }
  };
}

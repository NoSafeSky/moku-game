/**
 * @file graphics-2d plugin — the changeEpoch-gated render-sync system.
 *
 * "The component IS the renderable": this reconciler is what turns a `Shape` / `SpriteRenderer`
 * component into a view, and removing one back into nothing — driven ONLY through the renderer's
 * plain-data {@link RenderSurface}, so no `pixi.js` import is needed here.
 *
 * Reactivity is poll-on-epoch, not per-frame emit: the system early-outs on an unadvanced
 * `world.changeEpoch()`, so in edit mode (where most ticks carry no write) a tick costs one integer
 * compare and allocates nothing.
 */
import type { Component, Entity, System, World } from "../ecs/types";
import { shapeSig, shapeToPrimitiveSpec, spriteSig } from "./convert";
import type {
  RenderableKind,
  RenderSurface,
  ShapeValue,
  SpriteRendererValue,
  State
} from "./types";

/**
 * Structural context required by {@link createRenderSyncSystem} — only what the reconciler touches,
 * so a unit test drives it with a stub world and a recording mock renderer.
 */
export type RenderSyncContext = {
  /** graphics-2d state — the component tokens, the per-entity view tracker, and the epoch mark. */
  readonly state: State;
  /** The renderer's plain-data view seam. */
  readonly renderer: RenderSurface;
  /** The ECS world (queried for renderables and liveness). */
  readonly world: World;
};

/**
 * Creates the `sync`-stage render-sync system.
 *
 * Each run (only when the change epoch advanced) reconciles in three passes: Shapes, then
 * SpriteRenderers, then removals. Sprites are processed AFTER shapes so that on an entity carrying
 * both, the sprite view wins — `renderer.views` is keyed by entity, so P1 supports at most one
 * renderable per entity (composite views are a roadmap item).
 *
 * @param ctx - Structural context supplying state, the render seam, and the world.
 * @param ctx.state - graphics-2d state (tokens, `tracked`, `lastEpoch`).
 * @param ctx.renderer - The renderer's plain-data attach/detach/markDirty surface.
 * @param ctx.world - The ECS world to query.
 * @returns A `System` suitable for `world.addSystem("sync", …)`.
 * @example
 * ```ts
 * world.addSystem("sync", createRenderSyncSystem({ state: ctx.state, renderer, world }));
 * ```
 */
export const createRenderSyncSystem = (ctx: RenderSyncContext): System => {
  /**
   * Reconcile one renderable against its tracked view: attach when newly added, rebuild when the
   * value signature changed, and do nothing when it is unchanged.
   *
   * A rebuild is `detach` + attach (not an in-place edit) because a `kind` flip or an alias change
   * needs a DIFFERENT backing object; detaching first keeps the renderer's one-view-per-entity
   * registry correct and disposes the old view, so no VRAM leaks. `markDirty` then guarantees the
   * replacement view is repositioned on the renderer's next sync pass. The initial attach needs no
   * `markDirty` — the renderer stages a freshly attached view dirty already.
   *
   * Headless-tolerant: `attach` returning `false` (no Pixi app) is not an error, and the signature
   * is recorded regardless so the reconciler does not retry every epoch.
   *
   * @param entity - The entity whose view to reconcile.
   * @param kind - Which renderable component is driving the view.
   * @param sig - The current value signature of that component.
   * @param attach - Builds + stages the view for this entity.
   * @example
   * ```ts
   * reconcile(entity, "shape", sig, () => ctx.renderer.attachPrimitive(entity, spec));
   * ```
   */
  const reconcile = (
    entity: Entity,
    kind: RenderableKind,
    sig: string,
    attach: () => void
  ): void => {
    const tracked = ctx.state.tracked.get(entity);
    if (tracked && tracked.kind === kind && tracked.sig === sig) return;

    const isRebuild = tracked !== undefined;
    if (isRebuild) ctx.renderer.detach(entity);
    attach();
    if (isRebuild) ctx.renderer.markDirty(entity);

    ctx.state.tracked.set(entity, { kind, sig });
  };

  /**
   * Attach / rebuild the view of every entity carrying a Shape, EXCEPT one that also carries a
   * SpriteRenderer — the sprite wins the one-view-per-entity slot (P1 simplification), and it is
   * reconciled second by {@link reconcileSprites}. Skipping the dual-component case here (rather than
   * letting the sprite pass overwrite it) is what makes the tracker converge: without the skip, the
   * shape pass would rebuild the view to `shape` and the sprite pass would rebuild it back to
   * `sprite` on EVERY epoch-advancing tick (any write anywhere bumps the global changeEpoch),
   * thrashing a both-components entity forever with no value change.
   *
   * @param shapeToken - The Shape component token.
   * @param spriteToken - The SpriteRenderer component token (used only for the sprite-wins skip).
   * @example
   * ```ts
   * reconcileShapes(shapeToken, spriteToken);
   * ```
   */
  const reconcileShapes = (
    shapeToken: Component<ShapeValue>,
    spriteToken: Component<SpriteRendererValue>
  ): void => {
    for (const entity of ctx.world.query(shapeToken)) {
      if (ctx.world.has(entity, spriteToken)) continue; // sprite wins the single view slot

      const shape = ctx.world.get(entity, shapeToken);
      if (!shape) continue;

      reconcile(entity, "shape", shapeSig(shape), () => {
        ctx.renderer.attachPrimitive(entity, shapeToPrimitiveSpec(shape));
      });
    }
  };

  /**
   * Attach / rebuild the view of every entity carrying a SpriteRenderer.
   *
   * @param spriteToken - The SpriteRenderer component token.
   * @example
   * ```ts
   * reconcileSprites(spriteToken);
   * ```
   */
  const reconcileSprites = (spriteToken: Component<SpriteRendererValue>): void => {
    for (const entity of ctx.world.query(spriteToken)) {
      const sprite = ctx.world.get(entity, spriteToken);
      if (!sprite) continue;

      reconcile(entity, "sprite", spriteSig(sprite), () => {
        ctx.renderer.attachSprite(entity, {
          alias: sprite.sprite,
          tint: sprite.tint,
          flipX: sprite.flipX
        });
      });
    }
  };

  /**
   * Detach + untrack every view whose entity died, or whose backing component was removed.
   *
   * The renderer reconciles despawns itself, but graphics-2d must still drop its own tracking —
   * and a component removed from a still-LIVE entity is a case only this pass can catch, since the
   * renderer sees nothing wrong with a live entity.
   *
   * @param shapeToken - The Shape component token.
   * @param spriteToken - The SpriteRenderer component token.
   * @example
   * ```ts
   * reconcileRemovals(shapeToken, spriteToken);
   * ```
   */
  const reconcileRemovals = (
    shapeToken: Component<ShapeValue>,
    spriteToken: Component<SpriteRendererValue>
  ): void => {
    for (const [entity, tracked] of ctx.state.tracked) {
      const alive = ctx.world.isAlive(entity);
      const stillHasComponent =
        alive &&
        (tracked.kind === "shape"
          ? ctx.world.has(entity, shapeToken)
          : ctx.world.has(entity, spriteToken));
      if (stillHasComponent) continue;

      ctx.renderer.detach(entity);
      ctx.state.tracked.delete(entity);
    }
  };

  return (): void => {
    const epoch = ctx.world.changeEpoch();
    if (epoch === ctx.state.lastEpoch) return;
    ctx.state.lastEpoch = epoch;

    const { shapeToken, spriteToken } = ctx.state;
    if (!shapeToken || !spriteToken) return;

    reconcileShapes(shapeToken, spriteToken);
    reconcileSprites(spriteToken);
    reconcileRemovals(shapeToken, spriteToken);
  };
};

/**
 * @file vfx plugin — hit-flash tint stage system.
 *
 * Runs in the `"update"` stage. For every entity carrying a `Flash` it eases the
 * entity's renderer view `tint` from the flash `color` back to the captured
 * `baseTint` over `duration` (an ease-out settle), then at end of life restores
 * the EXACT captured `baseTint` and removes the `Flash` — so re-flashable entities
 * never drift. Headless-safe: when the entity has no view (`getEntityView` returns
 * undefined) the tint writes are skipped but the component lifecycle still
 * completes. Tint is a view-local property the renderer's Transform sync does not
 * manage, so this system writes it directly (no `markDirty`).
 */
import type { System, World } from "../../ecs/types";
import { easing } from "../easing";
import type { FlashComponent, RendererDep } from "../types";

/** Dependencies the flash stage system reads/writes. */
export type FlashSystemDeps = {
  /** The ECS world (removes the `Flash` when the flash ends). */
  readonly world: World;
  /** The vfx `Flash` token (queried each frame). */
  readonly Flash: FlashComponent;
  /** Renderer surface — per-entity view lookup so the tint can be applied. */
  readonly renderer: RendererDep;
};

/**
 * Blend two packed `0xRRGGBB` colors channel-wise.
 *
 * @param from - Source color (returned at `t = 0`).
 * @param to - Target color (returned at `t = 1`).
 * @param t - Interpolant, 0..1.
 * @returns The blended packed color.
 * @example
 * ```ts
 * lerpColor(0xff0000, 0xffffff, 0.5); // 0xff7f7f
 * ```
 */
const lerpColor = (from: number, to: number, t: number): number => {
  const fr = (from >> 16) & 0xff;
  const fg = (from >> 8) & 0xff;
  const fb = from & 0xff;
  const r = Math.round(fr + (((to >> 16) & 0xff) - fr) * t);
  const g = Math.round(fg + (((to >> 8) & 0xff) - fg) * t);
  const b = Math.round(fb + ((to & 0xff) - fb) * t);
  return (r << 16) | (g << 8) | b;
};

/**
 * Create the hit-flash tint system for the `"update"` stage.
 *
 * @param deps - World, the `Flash` token, and the renderer view lookup.
 * @returns A `System` that eases each flashed view's tint back to base + restores it.
 * @example
 * ```ts
 * scheduler.addSystem("update", createFlashSystem(deps));
 * ```
 */
export const createFlashSystem = (deps: FlashSystemDeps): System => {
  return (_world: World, dt: number): void => {
    deps.world.query(deps.Flash).updateEach(([flash], entity) => {
      flash.age += dt;
      const view = deps.renderer.getEntityView(entity);

      // End of life — restore the exact captured base tint and drop the Flash.
      if (flash.age >= flash.duration) {
        if (view) view.tint = flash.baseTint;
        deps.world.remove(entity, deps.Flash);
        return;
      }

      // Ease the tint from the flash color back toward the captured base.
      if (view) {
        const t = easing.easeOutQuad(flash.age / flash.duration);
        view.tint = lerpColor(flash.color, flash.baseTint, t);
      }
    });
  };
};

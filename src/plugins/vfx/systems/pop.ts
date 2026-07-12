/**
 * @file vfx plugin — scale-pop stage system.
 *
 * Runs in the `"update"` stage. For every entity carrying a `Pop` it eases the
 * `Transform` scale up to `amplitude ×` its captured base and back over
 * `duration` (a smooth `sin` pulse: base → apex → base), `markDirty`ing the view
 * each frame. At end of life it restores the EXACT captured base scale and
 * removes the `Pop` — so re-poppable entities never drift.
 */
import type { System, World } from "../../ecs/types";
import type { PopComponent, RendererDep, TransformComponent } from "../types";

/** Dependencies the pop stage system reads/writes. */
export type PopSystemDeps = {
  /** The ECS world (removes the `Pop` when the pop ends). */
  readonly world: World;
  /** The renderer's Transform token. */
  readonly transform: TransformComponent;
  /** The vfx `Pop` token (queried each frame). */
  readonly Pop: PopComponent;
  /** Renderer surface — `markDirty` after each Transform write. */
  readonly renderer: RendererDep;
};

/**
 * Create the scale-pop system for the `"update"` stage.
 *
 * @param deps - World, tokens, and renderer.
 * @returns A `System` that pulses + restores Transform scale for popped entities.
 * @example
 * ```ts
 * scheduler.addSystem("update", createPopSystem(deps));
 * ```
 */
export const createPopSystem = (deps: PopSystemDeps): System => {
  return (_world: World, dt: number): void => {
    deps.world.query(deps.Pop, deps.transform).updateEach(([pop, tf], entity) => {
      pop.age += dt;

      // End of life — restore the exact captured base scale and drop the Pop.
      if (pop.age >= pop.duration) {
        tf.scaleX = pop.baseScaleX;
        tf.scaleY = pop.baseScaleY;
        deps.renderer.markDirty(entity);
        deps.world.remove(entity, deps.Pop);
        return;
      }

      // Smooth base → apex → base pulse over the duration.
      const pulse = 1 + (pop.amplitude - 1) * Math.sin((pop.age / pop.duration) * Math.PI);
      tf.scaleX = pop.baseScaleX * pulse;
      tf.scaleY = pop.baseScaleY * pulse;
      deps.renderer.markDirty(entity);
    });
  };
};

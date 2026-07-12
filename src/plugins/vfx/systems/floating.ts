/**
 * @file vfx plugin — floating-text stage system.
 *
 * Runs in the `"update"` stage. For every floating-text entity it: ages it;
 * moves it upward (Pixi is y-down, so "rise" = DECREASE `Transform.y`) at
 * `riseSpeed`; lerps the retained `Text` handle's alpha `startAlpha → endAlpha`
 * (the renderer's sync system never touches alpha, which is why vfx keeps the
 * handle); `markDirty`s the view; and at end of life `despawn`s the entity and
 * drops its handle (the renderer disposes the `Text` on the next sync).
 *
 * **Headless-safe:** no `Text` handle exists (floatText skipped view creation),
 * so the alpha write is simply skipped — the entity still ages + despawns.
 */
import type { System, World } from "../../ecs/types";
import { lerp } from "../easing";
import type { FloatingTextComponent, RendererDep, State, TransformComponent } from "../types";

/** Dependencies the floating-text stage system reads/writes. */
export type FloatingSystemDeps = {
  /** The ECS world (despawns expired floating text). */
  readonly world: World;
  /** The renderer's Transform token. */
  readonly transform: TransformComponent;
  /** The vfx `FloatingText` token (queried each frame). */
  readonly FloatingText: FloatingTextComponent;
  /** Renderer surface — `markDirty` after each Transform write. */
  readonly renderer: RendererDep;
  /** vfx state — the retained `Text` handles (for per-frame alpha). */
  readonly state: State;
};

/**
 * Create the floating-text system for the `"update"` stage.
 *
 * @param deps - World, tokens, renderer, and state.
 * @returns A `System` that rises, fades, and despawns floating text.
 * @example
 * ```ts
 * scheduler.addSystem("update", createFloatingSystem(deps));
 * ```
 */
export const createFloatingSystem = (deps: FloatingSystemDeps): System => {
  return (_world: World, dt: number): void => {
    deps.world.query(deps.FloatingText, deps.transform).updateEach(([float, tf], entity) => {
      float.age += dt;

      // End of life — despawn (deferred) and drop the vfx-owned handle. The
      // renderer disposes the Text itself via its despawn reconciliation.
      if (float.age >= float.lifetime) {
        deps.world.despawn(entity);
        deps.state.views.delete(entity);
        return;
      }

      // Rise upward (y-down space → subtract) and fade the retained Text handle.
      tf.y -= float.riseSpeed * dt;

      const view = deps.state.views.get(entity);
      if (view) {
        view.alpha = lerp(float.startAlpha, float.endAlpha, float.age / float.lifetime);
      }

      deps.renderer.markDirty(entity);
    });
  };
};

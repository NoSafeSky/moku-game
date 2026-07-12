/**
 * @file vfx plugin — particle integration stage system.
 *
 * Runs in the `"update"` stage. For every live particle it: ages it; integrates
 * gravity into velocity and velocity into the `Transform`; eases the `Transform`
 * scale `startScale → endScale` (fade-by-shrink, since particle views render
 * through `attachPrimitive` and the renderer owns their alpha); `markDirty`s the
 * view so the sync stage repositions it; and `despawn`s it at end of life
 * (decrementing the live-particle counter for the `maxParticles` cap).
 */
import type { System, World } from "../../ecs/types";
import { easing, lerp } from "../easing";
import type { ParticleComponent, RendererDep, State, TransformComponent } from "../types";

/** Dependencies the particle stage system reads/writes. */
export type ParticleSystemDeps = {
  /** The ECS world (despawns expired particles). */
  readonly world: World;
  /** The renderer's Transform token. */
  readonly transform: TransformComponent;
  /** The vfx `Particle` token (queried each frame). */
  readonly Particle: ParticleComponent;
  /** Renderer surface — `markDirty` after each Transform write. */
  readonly renderer: RendererDep;
  /** vfx state — the live particle counter (decremented on despawn). */
  readonly state: State;
};

/**
 * Create the particle integration system for the `"update"` stage.
 *
 * @param deps - World, tokens, renderer, and state.
 * @returns A `System` that ages, integrates, fades, and despawns particles.
 * @example
 * ```ts
 * scheduler.addSystem("update", createParticleSystem(deps));
 * ```
 */
export const createParticleSystem = (deps: ParticleSystemDeps): System => {
  return (_world: World, dt: number): void => {
    deps.world.query(deps.Particle, deps.transform).updateEach(([particle, tf], entity) => {
      particle.age += dt;

      // End of life — despawn (deferred) and free a cap slot.
      if (particle.age >= particle.lifetime) {
        deps.world.despawn(entity);
        deps.state.particleCount = Math.max(0, deps.state.particleCount - 1);
        return;
      }

      // Integrate gravity → velocity → position.
      particle.vx += particle.gravityX * dt;
      particle.vy += particle.gravityY * dt;
      tf.x += particle.vx * dt;
      tf.y += particle.vy * dt;

      // Fade by shrinking the Transform scale toward endScale.
      const progress = easing.easeOutQuad(particle.age / particle.lifetime);
      const scale = lerp(particle.startScale, particle.endScale, progress);
      tf.scaleX = scale;
      tf.scaleY = scale;

      deps.renderer.markDirty(entity);
    });
  };
};

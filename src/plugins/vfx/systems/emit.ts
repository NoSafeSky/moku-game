/**
 * @file vfx plugin — particle emission core + the emit stage system.
 *
 * `emitParticles` is the shared spawn core used by BOTH the per-frame emit system
 * (persistent {@link EmitterValue} entities) and the one-shot `burst` API — each
 * particle is an ECS entity (`Particle` + `Transform`) whose Graphics view is
 * staged through `renderer.attachPrimitive` (so the renderer owns its whole view
 * lifecycle). Emission respects the global `maxParticles` cap; over-budget
 * particles are dropped (the emit system debug-logs once per over-budget frame).
 *
 * Runs in the `"update"` stage: particles spawned here are flushed live by the
 * ECS command buffer before the `"sync"` stage, so they are visible the same frame.
 */
import type { Entity, System, World } from "../../ecs/types";
import type {
  Config,
  EmitterComponent,
  Log,
  ParticleComponent,
  RendererDep,
  State,
  TransformComponent
} from "../types";

/**
 * Sentinel entity handle for burst particles (no owning emitter). Always dead
 * (index/generation `0xFFFF` never allocated). The `as Entity` cast is the
 * framework's branded-handle construction idiom — the same one `ecs/entity.ts`
 * uses to mint real handles — applied here to a documented sentinel used only for
 * `===` comparison in `removeEmitter`'s particle sweep, never passed to the world.
 */
export const DEAD_ENTITY = -1 as Entity;

/** Floor so a particle's `lifetime` is never zero (guards `age / lifetime`). */
const MIN_LIFETIME = 0.0001;

/**
 * Fully-resolved per-particle emission parameters (no optionals) — the shared
 * currency between the emit system, `burst`, and {@link emitParticles}.
 */
export type ParticleParameters = {
  /** Emission direction, radians. */
  angle: number;
  /** ± half-cone around `angle`, radians. */
  spread: number;
  /** Launch speed, px/second. */
  speed: number;
  /** ± speed jitter, px/second. */
  speedVariance: number;
  /** Lifetime, seconds. */
  lifetime: number;
  /** ± lifetime jitter, seconds. */
  lifetimeVariance: number;
  /** Initial Transform scale. */
  startScale: number;
  /** Fade-by-shrink target scale. */
  endScale: number;
  /** Primitive radius, px. */
  radius: number;
  /** Color, hex int. */
  color: number;
  /** Horizontal gravity, px/second². */
  gravityX: number;
  /** Vertical gravity, px/second². */
  gravityY: number;
  /** Owning emitter entity, or {@link DEAD_ENTITY} for burst particles. */
  emitter: Entity;
};

/** Dependencies the emission core reads/writes. */
export type EmitDeps = {
  /** The ECS world (spawns particle entities). */
  readonly world: World;
  /** The renderer's Transform token. */
  readonly transform: TransformComponent;
  /** The vfx `Particle` token. */
  readonly Particle: ParticleComponent;
  /** Renderer surface — `attachPrimitive` stages each particle's Graphics view. */
  readonly renderer: RendererDep;
  /** vfx state — the live particle counter (cap accounting). */
  readonly state: State;
  /** Resolved config — the `maxParticles` cap. */
  readonly config: Readonly<Config>;
  /** Random source in `[0, 1)` (injectable for deterministic tests). */
  readonly random: () => number;
};

/**
 * Spawn up to `count` particles at (x, y), honouring the global `maxParticles`
 * cap. Each particle gets a randomized velocity inside the `angle ± spread` cone,
 * a `Particle` + `Transform`, and a Graphics view via `attachPrimitive`.
 *
 * @param deps - The emission dependencies (world, tokens, renderer, state, config, rng).
 * @param x - World-space X to emit at.
 * @param y - World-space Y to emit at.
 * @param params - Fully-resolved per-particle parameters.
 * @param count - How many particles to attempt to spawn.
 * @returns The number actually spawned (`< count` when the cap was hit).
 * @example
 * ```ts
 * const spawned = emitParticles(deps, 100, 50, params, 16);
 * ```
 */
export const emitParticles = (
  deps: EmitDeps,
  x: number,
  y: number,
  params: ParticleParameters,
  count: number
): number => {
  let spawned = 0;

  for (let index = 0; index < count; index++) {
    // Global cap — drop the remaining requested particles once full.
    if (deps.state.particleCount >= deps.config.maxParticles) break;

    // Randomize direction within the cone and jitter speed + lifetime.
    const direction = params.angle + (deps.random() * 2 - 1) * params.spread;
    const speed = Math.max(0, params.speed + (deps.random() * 2 - 1) * params.speedVariance);
    const lifetime = Math.max(
      MIN_LIFETIME,
      params.lifetime + (deps.random() * 2 - 1) * params.lifetimeVariance
    );

    const entity = deps.world.spawn(
      deps.transform({ x, y, rotation: 0, scaleX: params.startScale, scaleY: params.startScale }),
      deps.Particle({
        vx: Math.cos(direction) * speed,
        vy: Math.sin(direction) * speed,
        age: 0,
        lifetime,
        startScale: params.startScale,
        endScale: params.endScale,
        gravityX: params.gravityX,
        gravityY: params.gravityY,
        emitter: params.emitter
      })
    );

    // Renderer owns the view (stage-add + per-tick sync + despawn disposal).
    // No-op / false when headless — the particle still simulates.
    deps.renderer.attachPrimitive(entity, {
      shape: "circle",
      radius: params.radius,
      fill: params.color
    });

    deps.state.particleCount++;
    spawned++;
  }

  return spawned;
};

/** Dependencies the emit stage system needs (emission core + the Emitter token + log). */
export type EmitSystemDeps = EmitDeps & {
  /** The vfx `Emitter` token (queried each frame). */
  readonly Emitter: EmitterComponent;
  /** Logger for the once-per-over-budget-frame cap notice. */
  readonly log: Log;
};

/**
 * Create the emit stage system: for every enabled emitter it accumulates
 * `rate · dt`, spawns the whole-number part of the accumulator, and carries the
 * fractional remainder to the next frame (so `rate = 60` yields ≈1 particle per
 * 1/60 s tick with no double-spawn). Over-budget emission is dropped and
 * debug-logged once per frame.
 *
 * @param deps - Emission core + the Emitter token + logger.
 * @returns A `System` for the `"update"` stage.
 * @example
 * ```ts
 * scheduler.addSystem("update", createEmitSystem(deps));
 * ```
 */
export const createEmitSystem = (deps: EmitSystemDeps): System => {
  return (_world: World, dt: number): void => {
    let dropped = 0;

    deps.world.query(deps.Emitter, deps.transform).updateEach(([em, tf], emitterEntity) => {
      // Paused / zero-rate emitters keep their particles but emit nothing.
      const isEmitterIdle = !em.enabled || em.rate <= 0;
      if (isEmitterIdle) return;

      em.accumulator += em.rate * dt;
      const desired = Math.floor(em.accumulator);
      if (desired <= 0) return;
      em.accumulator -= desired;

      const spawned = emitParticles(
        deps,
        tf.x,
        tf.y,
        {
          angle: em.angle,
          spread: em.spread,
          speed: em.speed,
          speedVariance: em.speedVariance,
          lifetime: em.lifetime,
          lifetimeVariance: em.lifetimeVariance,
          startScale: em.startScale,
          endScale: em.endScale,
          radius: em.radius,
          color: em.color,
          gravityX: em.gravityX,
          gravityY: em.gravityY,
          emitter: emitterEntity
        },
        desired
      );

      dropped += desired - spawned;
    });

    if (dropped > 0) {
      deps.log.debug(
        `[vfx] maxParticles (${deps.config.maxParticles}) reached — dropped ${dropped} particle(s) this frame.`
      );
    }
  };
};

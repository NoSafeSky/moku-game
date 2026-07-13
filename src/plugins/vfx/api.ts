/**
 * @file vfx plugin — API factory (the `app.vfx` surface).
 *
 * Exposes emitters (`createEmitter`/`configureEmitter`/`setEmitterEnabled`/
 * `removeEmitter`), one-shot `burst`, `shake`/`stopShake`, `pop`, `flash`,
 * `floatText`, and the pure `easing`/`lerp` helpers. `burst` shares the emission core the
 * emit system uses. Every effectful method is a guarded no-op before onStart (the
 * component tokens are undefined) and on dead / wrong-type entities — so misuse
 * degrades quietly rather than throwing on the frame hot path.
 */
import { ecsPlugin } from "../ecs";
import type { Entity, World } from "../ecs/types";
import { rendererPlugin } from "../renderer";
import type { Api as RendererApi } from "../renderer/types";
import { easing, lerp } from "./easing";
import { DEAD_ENTITY, type EmitDeps, emitParticles, type ParticleParameters } from "./systems/emit";
import type {
  Api,
  BurstSpec,
  Config,
  EmitterComponent,
  EmitterSpec,
  EmitterValue,
  FlashComponent,
  FlashOptions,
  FloatingTextComponent,
  FloatTextOptions,
  Log,
  ParticleComponent,
  PopComponent,
  PopOptions,
  State,
  TransformComponent
} from "./types";
import { buildText } from "./views";

/**
 * Structural context required by {@link createApi}, so unit tests can pass a
 * minimal mock without wiring the full kernel. Mirrors the RendererContext /
 * AssetsContext pattern used across this framework.
 */
export type VfxApiContext = {
  /** Resolved vfx configuration (default color, cap, shake tuning). */
  readonly config: Readonly<Config>;
  /** vfx plugin state — tokens, trauma, particle count, and the Text handles. */
  readonly state: State;
  /** Logger from logPlugin (before-start + cap notices). */
  readonly log: Log;
  /** Require a dependency's API by plugin instance (`ecs` / `renderer`). */
  require: ((plugin: typeof ecsPlugin) => World) & ((plugin: typeof rendererPlugin) => RendererApi);
};

/** The started tokens + dependency APIs, resolved together (undefined before start). */
type Resolved = {
  /** The ECS world. */
  readonly world: World;
  /** The renderer API. */
  readonly renderer: RendererApi;
  /** The renderer's Transform token. */
  readonly transform: TransformComponent;
  /** The vfx `Emitter` token. */
  readonly Emitter: EmitterComponent;
  /** The vfx `Particle` token. */
  readonly Particle: ParticleComponent;
  /** The vfx `Pop` token. */
  readonly Pop: PopComponent;
  /** The vfx `Flash` token. */
  readonly Flash: FlashComponent;
  /** The vfx `FloatingText` token. */
  readonly FloatingText: FloatingTextComponent;
};

/**
 * Clamp `v` into the inclusive `[lo, hi]` range.
 *
 * @param v - The value to clamp.
 * @param lo - Lower bound.
 * @param hi - Upper bound.
 * @returns `v` constrained to `[lo, hi]`.
 * @example
 * ```ts
 * clamp(1.4, 0, 1); // 1
 * ```
 */
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Whether an entity is a live emitter (alive + carries the `Emitter` component).
 *
 * @param r - The resolved tokens + world.
 * @param emitter - The candidate emitter entity.
 * @returns `true` when `emitter` is a live emitter.
 * @example
 * ```ts
 * if (!isLiveEmitter(r, e)) return; // no-op on dead / non-emitter
 * ```
 */
const isLiveEmitter = (r: Resolved, emitter: Entity): boolean =>
  r.world.isAlive(emitter) && r.world.has(emitter, r.Emitter);

/**
 * Creates the vfx plugin API surface.
 *
 * @param ctx - Plugin context (structural — only the fields this API uses).
 * @param ctx.config - Resolved vfx configuration.
 * @param ctx.state - vfx plugin state (tokens, trauma, particle count, views).
 * @param ctx.log - Logger from logPlugin.
 * @param ctx.require - Kernel function to obtain the `ecs` / `renderer` APIs.
 * @returns The vfx plugin {@link Api} object.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * api.burst(x, y, { count: 16, speed: 220, lifetime: 0.5, color: 0xffcc00 });
 * api.shake(0.5, 0.3);
 * ```
 */
export const createApi = (ctx: VfxApiContext): Api => {
  /**
   * Resolve the started tokens + dependency APIs together, or `undefined` before
   * onStart has defined them (so every effectful method can guard uniformly).
   *
   * @returns The resolved tokens + APIs, or `undefined` when not started.
   * @example
   * ```ts
   * const r = resolved();
   * if (!r) return; // not started — no-op
   * ```
   */
  const resolved = (): Resolved | undefined => {
    const { transform, Emitter, Particle, Pop, Flash, FloatingText } = ctx.state;
    if (!transform || !Emitter || !Particle || !Pop || !Flash || !FloatingText) return undefined;
    return {
      world: ctx.require(ecsPlugin),
      renderer: ctx.require(rendererPlugin),
      transform,
      Emitter,
      Particle,
      Pop,
      Flash,
      FloatingText
    };
  };

  return {
    /**
     * Spawn a persistent emitter entity (Emitter + Transform at x/y). No-op
     * (returns a dead handle) before start.
     *
     * @param spec - Persistent emitter parameters.
     * @returns The emitter entity handle (dead handle before start).
     * @example
     * ```ts
     * const trail = api.createEmitter({ rate: 80, speed: 40, spread: 0.3, lifetime: 0.6 });
     * ```
     */
    createEmitter(spec: EmitterSpec): Entity {
      const r = resolved();
      if (!r) {
        ctx.log.warn("[vfx] createEmitter called before start — no emitter spawned.");
        return DEAD_ENTITY;
      }

      const value: EmitterValue = {
        enabled: spec.enabled ?? true,
        rate: spec.rate,
        accumulator: 0,
        angle: spec.angle ?? 0,
        spread: spec.spread ?? 0.3,
        speed: spec.speed,
        speedVariance: spec.speedVariance ?? 0,
        lifetime: spec.lifetime,
        lifetimeVariance: spec.lifetimeVariance ?? 0,
        startScale: spec.startScale ?? 1,
        endScale: spec.endScale ?? 0,
        radius: spec.radius ?? 2,
        color: spec.color ?? ctx.config.defaultColor,
        gravityX: spec.gravityX ?? 0,
        gravityY: spec.gravityY ?? 0
      };

      return r.world.spawn(
        r.Emitter(value),
        r.transform({ x: spec.x ?? 0, y: spec.y ?? 0, rotation: 0, scaleX: 1, scaleY: 1 })
      );
    },

    /**
     * Shallow-merge new emission parameters into a live emitter. `x`/`y` are
     * ignored here (move the emitter by writing its Transform). No-op for a dead /
     * non-emitter entity.
     *
     * @param emitter - The emitter entity to reconfigure.
     * @param patch - The emission parameters to merge.
     * @example
     * ```ts
     * api.configureEmitter(trail, { rate: 40, color: 0x66ccff });
     * ```
     */
    configureEmitter(emitter: Entity, patch: Partial<EmitterSpec>): void {
      const r = resolved();
      if (!r || !isLiveEmitter(r, emitter)) return;

      // Copy only the provided emission params (x/y are Transform, not emission).
      const update: Partial<EmitterValue> = {};
      if (patch.enabled !== undefined) update.enabled = patch.enabled;
      if (patch.rate !== undefined) update.rate = patch.rate;
      if (patch.angle !== undefined) update.angle = patch.angle;
      if (patch.spread !== undefined) update.spread = patch.spread;
      if (patch.speed !== undefined) update.speed = patch.speed;
      if (patch.speedVariance !== undefined) update.speedVariance = patch.speedVariance;
      if (patch.lifetime !== undefined) update.lifetime = patch.lifetime;
      if (patch.lifetimeVariance !== undefined) update.lifetimeVariance = patch.lifetimeVariance;
      if (patch.startScale !== undefined) update.startScale = patch.startScale;
      if (patch.endScale !== undefined) update.endScale = patch.endScale;
      if (patch.radius !== undefined) update.radius = patch.radius;
      if (patch.color !== undefined) update.color = patch.color;
      if (patch.gravityX !== undefined) update.gravityX = patch.gravityX;
      if (patch.gravityY !== undefined) update.gravityY = patch.gravityY;

      r.world.set(emitter, r.Emitter, update);
    },

    /**
     * Pause/resume emission without despawning (keeps existing particles alive).
     * No-op for a dead / non-emitter entity.
     *
     * @param emitter - The emitter entity.
     * @param enabled - Whether the emitter should emit.
     * @example
     * ```ts
     * api.setEmitterEnabled(trail, false); // pause
     * ```
     */
    setEmitterEnabled(emitter: Entity, enabled: boolean): void {
      const r = resolved();
      if (!r || !isLiveEmitter(r, emitter)) return;
      r.world.set(emitter, r.Emitter, { enabled });
    },

    /**
     * Despawn an emitter AND its currently-live particles. No-op for a dead /
     * non-emitter entity.
     *
     * @param emitter - The emitter entity to remove.
     * @example
     * ```ts
     * api.removeEmitter(trail);
     * ```
     */
    removeEmitter(emitter: Entity): void {
      const r = resolved();
      if (!r || !isLiveEmitter(r, emitter)) return;

      // Despawn the emitter's own particles (owner back-reference), decrementing
      // the live-particle counter for each; then despawn the emitter itself.
      r.world.query(r.Particle).updateEach(([particle], entity) => {
        if (particle.emitter === emitter) {
          r.world.despawn(entity);
          ctx.state.particleCount = Math.max(0, ctx.state.particleCount - 1);
        }
      });
      r.world.despawn(emitter);
    },

    /**
     * Emit `count` particles instantly at (x, y). Respects the global
     * `maxParticles` cap (over-budget particles are dropped + debug-logged).
     * No-op before start.
     *
     * @param x - World-space X to emit at.
     * @param y - World-space Y to emit at.
     * @param spec - One-shot burst parameters.
     * @example
     * ```ts
     * api.burst(hit.x, hit.y, { count: 16, speed: 220, lifetime: 0.5, radius: 3 });
     * ```
     */
    burst(x: number, y: number, spec: BurstSpec): void {
      const r = resolved();
      if (!r) return;

      const deps: EmitDeps = {
        world: r.world,
        transform: r.transform,
        Particle: r.Particle,
        renderer: r.renderer,
        state: ctx.state,
        config: ctx.config,
        random: Math.random
      };

      const params: ParticleParameters = {
        angle: spec.angle ?? 0,
        spread: spec.spread ?? Math.PI,
        speed: spec.speed,
        speedVariance: spec.speedVariance ?? 0,
        lifetime: spec.lifetime,
        lifetimeVariance: spec.lifetimeVariance ?? 0,
        startScale: spec.startScale ?? 1,
        endScale: spec.endScale ?? 0,
        radius: spec.radius ?? 2,
        color: spec.color ?? ctx.config.defaultColor,
        gravityX: spec.gravityX ?? 0,
        gravityY: spec.gravityY ?? 0,
        emitter: DEAD_ENTITY
      };

      const spawned = emitParticles(deps, x, y, params, spec.count);
      if (spawned < spec.count) {
        ctx.log.debug(
          `[vfx] burst dropped ${spec.count - spawned} particle(s) — maxParticles (${ctx.config.maxParticles}) reached.`
        );
      }
    },

    /**
     * Add screen-shake trauma. `amplitude` sets minimum intensity; `duration`
     * banks enough trauma to persist roughly that long (given `shakeDecay`).
     * Accumulates and clamps to 1. No-op before start.
     *
     * @param amplitude - Trauma intensity contribution, 0..1.
     * @param duration - Rough seconds the shake should persist.
     * @example
     * ```ts
     * api.shake(0.5, 0.3); // punchy screen shake
     * ```
     */
    shake(amplitude: number, duration: number): void {
      if (ctx.state.transform === undefined) return; // not started
      const banked = Math.max(amplitude, duration * ctx.config.shakeDecay);
      ctx.state.trauma = clamp(ctx.state.trauma + banked, 0, 1);
    },

    /**
     * Immediately clear all shake trauma and reset the stage offset to (0, 0).
     * No-op before start.
     *
     * @example
     * ```ts
     * api.stopShake();
     * ```
     */
    stopShake(): void {
      if (ctx.state.transform === undefined) return; // not started
      ctx.state.trauma = 0;
      ctx.require(rendererPlugin).getStage()?.position.set(0, 0);
    },

    /**
     * Scale-pop an entity's Transform: pops to `scale`× then eases back over
     * `duration`. No-op if the entity is dead or lacks a Transform. Re-calling
     * refreshes the pop while preserving the originally-captured base scale.
     *
     * @param entity - The entity to pop.
     * @param opts - Optional peak scale (default 1.3) + duration (default 0.15).
     * @example
     * ```ts
     * api.pop(enemy, { scale: 1.4, duration: 0.12 });
     * ```
     */
    pop(entity: Entity, opts?: PopOptions): void {
      const r = resolved();
      if (!r) return;
      if (!r.world.isAlive(entity) || !r.world.has(entity, r.transform)) return;

      const scale = opts?.scale ?? 1.3;
      const duration = opts?.duration ?? 0.15;

      // Refresh an in-flight pop without recapturing the (mid-pop) base scale.
      if (r.world.has(entity, r.Pop)) {
        r.world.set(entity, r.Pop, { age: 0, amplitude: scale, duration });
        return;
      }

      const tf = r.world.get(entity, r.transform);
      if (!tf) return; // defensive — has() reported the Transform present

      r.world.add(entity, r.Pop, {
        age: 0,
        duration,
        amplitude: scale,
        baseScaleX: tf.scaleX,
        baseScaleY: tf.scaleY
      });
    },

    /**
     * Hit-flash an entity's view: snap its `tint` to `color`, then ease back to
     * the captured base tint over `duration` (restored exactly). No-op if the
     * entity is dead. The tint is only visible when the entity has an attached
     * view — headless / view-less entities age the effect out with no tint write.
     * Re-calling refreshes the flash while preserving the originally-captured base.
     *
     * @param entity - The entity whose view to flash.
     * @param opts - Optional flash color (default white) + duration (default 0.12).
     * @example
     * ```ts
     * api.flash(enemy, { color: 0xffffff, duration: 0.12 }); // white hit flash
     * ```
     */
    flash(entity: Entity, opts?: FlashOptions): void {
      const r = resolved();
      if (!r) return;
      if (!r.world.isAlive(entity)) return;

      const color = opts?.color ?? 0xff_ff_ff;
      const duration = opts?.duration ?? 0.12;
      const view = r.renderer.getEntityView(entity);

      // Refresh an in-flight flash without recapturing the (mid-flash) base tint;
      // re-snap the visible tint to the new color so the refresh shows immediately
      // (consistent with the initial-flash snap below).
      if (r.world.has(entity, r.Flash)) {
        r.world.set(entity, r.Flash, { age: 0, color, duration });
        if (view) view.tint = color;
        return;
      }

      // Capture the view's current tint so it restores exactly (white when
      // headless / unattached), then snap to the flash color now so a flash is
      // visible even before the first update tick.
      const baseTint = view?.tint ?? 0xff_ff_ff;
      r.world.add(entity, r.Flash, { age: 0, duration, color, baseTint });
      if (view) view.tint = color;
    },

    /**
     * Spawn a rising, alpha-fading floating number/text at (x, y). Returns the
     * entity handle (dead handle before start). Headless → the entity + component
     * are created but no `Text` view is built.
     *
     * @param x - World-space X.
     * @param y - World-space Y.
     * @param text - The string to display.
     * @param opts - Optional lifetime / rise / alpha / color / font size.
     * @returns The floating-text entity handle.
     * @example
     * ```ts
     * api.floatText(hit.x, hit.y - 20, "+50", { color: 0xffffff });
     * ```
     */
    floatText(x: number, y: number, text: string, opts?: FloatTextOptions): Entity {
      const r = resolved();
      if (!r) {
        ctx.log.warn("[vfx] floatText called before start — no text spawned.");
        return DEAD_ENTITY;
      }

      const startAlpha = opts?.startAlpha ?? 1;
      const entity = r.world.spawn(
        r.FloatingText({
          age: 0,
          lifetime: opts?.lifetime ?? 1,
          riseSpeed: opts?.riseSpeed ?? 40,
          startAlpha,
          endAlpha: opts?.endAlpha ?? 0
        }),
        r.transform({ x, y, rotation: 0, scaleX: 1, scaleY: 1 })
      );

      // Build + attach the Text only when a live stage exists (headless → none).
      const stage = r.renderer.getStage();
      if (stage) {
        const view = buildText({
          text,
          color: opts?.color ?? ctx.config.defaultColor,
          fontSize: opts?.fontSize ?? 16,
          alpha: startAlpha
        });
        r.renderer.attach(entity, view);
        ctx.state.views.set(entity, view);
      }

      return entity;
    },

    /**
     * Pure easing curves `f(t): [0,1]→[0,1]`, keyed by name.
     */
    easing,

    /**
     * Linear interpolation `a + (b − a) * t`.
     *
     * @param a - Start value.
     * @param b - End value.
     * @param t - Interpolant, typically 0..1.
     * @returns The interpolated value.
     * @example
     * ```ts
     * api.lerp(0, 100, 0.25); // 25
     * ```
     */
    lerp
  };
};

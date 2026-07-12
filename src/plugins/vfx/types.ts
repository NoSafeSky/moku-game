/**
 * @file vfx plugin — type definitions.
 *
 * All Pixi types are confined to this file and the other vfx domain files
 * (`views.ts`, `systems/*`). Nothing leaks past the plugin boundary except the
 * structural `Container` handle stored in state (floating-text views) — exactly
 * as the renderer scopes it.
 */
import type { Container } from "pixi.js";
import type { Component, Entity } from "../ecs/types";
import type { PrimitiveSpec, TransformValue } from "../renderer/types";

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

/**
 * vfx plugin configuration. Colors are hex ints (e.g. `0xff3355`). Distances are
 * in world-space pixels; times are in seconds; rates are per second.
 */
export type Config = {
  /**
   * Global cap on simultaneously-live particles across every emitter + burst.
   * Emission is dropped (debug-logged once per over-budget frame) past this.
   *
   * @default 1000
   */
  maxParticles: number;
  /**
   * Screen-shake trauma decay in units/second (trauma is 0..1).
   *
   * @default 1.8
   */
  shakeDecay: number;
  /**
   * Maximum stage offset in pixels at trauma = 1 (offset scales with trauma²).
   *
   * @default 24
   */
  shakeMaxOffset: number;
  /**
   * Fallback particle/text color when a spec omits `color`.
   *
   * @default 0xffffff
   */
  defaultColor: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Component value shapes
// ─────────────────────────────────────────────────────────────────────────────

/** Emission parameters + runtime accumulator, carried by an emitter ENTITY. */
export type EmitterValue = {
  /** Whether the emitter is currently emitting (paused emitters keep their particles). */
  enabled: boolean;
  /** Particles emitted per second. */
  rate: number;
  /** Fractional-particle carry between frames (runtime accumulator). */
  accumulator: number;
  /** Emission direction, radians. */
  angle: number;
  /** ± half-cone around `angle`, radians. */
  spread: number;
  /** Particle launch speed, px/second. */
  speed: number;
  /** ± speed jitter, px/second. */
  speedVariance: number;
  /** Particle lifetime, seconds. */
  lifetime: number;
  /** ± lifetime jitter, seconds. */
  lifetimeVariance: number;
  /** Initial Transform scale of each particle. */
  startScale: number;
  /** Fade-by-shrink target scale (≈0). */
  endScale: number;
  /** Particle primitive radius, px. */
  radius: number;
  /** Particle color, hex int. */
  color: number;
  /** Horizontal gravity applied to particles, px/second². */
  gravityX: number;
  /** Vertical gravity applied to particles, px/second². */
  gravityY: number;
};

/** Per-particle runtime, carried by a particle ENTITY (alongside Transform). */
export type ParticleValue = {
  /** Horizontal velocity, px/second. */
  vx: number;
  /** Vertical velocity, px/second. */
  vy: number;
  /** Seconds since spawn. */
  age: number;
  /** Total lifetime, seconds. */
  lifetime: number;
  /** Initial Transform scale. */
  startScale: number;
  /** Fade-by-shrink target scale. */
  endScale: number;
  /** Horizontal gravity, px/second². */
  gravityX: number;
  /** Vertical gravity, px/second². */
  gravityY: number;
  /**
   * The owning emitter entity, or {@link DEAD_ENTITY} for one-shot `burst` particles.
   *
   * This back-reference is what lets `removeEmitter` despawn an emitter together
   * with only *its* live particles (burst particles carry the sentinel and are
   * never swept by an emitter removal).
   */
  emitter: Entity;
};

/** Transform scale-pop juice, carried transiently by any entity `pop()` targets. */
export type PopValue = {
  /** Seconds since the pop began. */
  age: number;
  /** Total pop duration, seconds. */
  duration: number;
  /** Peak scale multiplier at the pop's apex (e.g. 1.4). */
  amplitude: number;
  /** Captured base horizontal scale, restored exactly when the pop ends. */
  baseScaleX: number;
  /** Captured base vertical scale, restored exactly when the pop ends. */
  baseScaleY: number;
};

/** Floating rising/fading number/text runtime (view = a Text handle in state.views). */
export type FloatingTextValue = {
  /** Seconds since spawn. */
  age: number;
  /** Total lifetime, seconds. */
  lifetime: number;
  /** Upward rise speed, px/second. */
  riseSpeed: number;
  /** Initial alpha. */
  startAlpha: number;
  /** Final alpha (faded to). */
  endAlpha: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Component tokens (resolved after onStart)
// ─────────────────────────────────────────────────────────────────────────────

/** The `Emitter` component token defined on the ECS world in onStart. */
export type EmitterComponent = Component<EmitterValue>;
/** The `Particle` component token defined on the ECS world in onStart. */
export type ParticleComponent = Component<ParticleValue>;
/** The `Pop` component token defined on the ECS world in onStart. */
export type PopComponent = Component<PopValue>;
/** The `FloatingText` component token defined on the ECS world in onStart. */
export type FloatingTextComponent = Component<FloatingTextValue>;
/** The renderer's `Transform` component token, captured in onStart. */
export type TransformComponent = Component<TransformValue>;

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

/**
 * vfx plugin mutable state.
 *
 * Holds only plain, GC-able data plus the vfx-owned floating-text `Text` handles.
 * There is **no** `ctx.global` WeakMap: unlike renderer/loop/audio/platform, vfx
 * owns no external OS/GPU resource of its own — every view it creates is
 * registered with the renderer (via `attach`/`attachPrimitive`), so disposal is
 * the renderer's responsibility.
 */
export type State = {
  /** The renderer's Transform token, captured in onStart (undefined before start). */
  transform: TransformComponent | undefined;
  /** The `Emitter` token (undefined before onStart defines it on the world). */
  Emitter: EmitterComponent | undefined;
  /** The `Particle` token (undefined before onStart defines it on the world). */
  Particle: ParticleComponent | undefined;
  /** The `Pop` token (undefined before onStart defines it on the world). */
  Pop: PopComponent | undefined;
  /** The `FloatingText` token (undefined before onStart defines it on the world). */
  FloatingText: FloatingTextComponent | undefined;
  /**
   * Handles for vfx-owned effect views that need per-frame alpha control —
   * ONLY floating-text `Text` objects (particles are handle-free, owned by renderer).
   */
  readonly views: Map<Entity, Container>;
  /** Current screen-shake trauma, 0..1. Decays by `shakeDecay` each frame. */
  trauma: number;
  /** Live particle count, maintained by the emit/particle systems for the `maxParticles` cap. */
  particleCount: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// API specs + surface
// ─────────────────────────────────────────────────────────────────────────────

/** Names of the pure easing curves vfx ships (and exports for consumer juice). */
export type EasingName =
  | "linear"
  | "easeInQuad"
  | "easeOutQuad"
  | "easeInOutQuad"
  | "easeOutCubic"
  | "easeOutBack"
  | "easeOutElastic";

/** Persistent emitter parameters (all but `rate`/`speed`/`lifetime` optional → config/sane defaults). */
export type EmitterSpec = {
  /** Spawn origin X (default 0); move later via the returned entity's Transform. */
  x?: number;
  /** Spawn origin Y (default 0); move later via the returned entity's Transform. */
  y?: number;
  /** Particles emitted per second. */
  rate: number;
  /** Emission direction, radians (default 0). */
  angle?: number;
  /** ± half-cone around `angle`, radians (default 0.3). */
  spread?: number;
  /** Particle launch speed, px/second. */
  speed: number;
  /** ± speed jitter, px/second (default 0). */
  speedVariance?: number;
  /** Particle lifetime, seconds. */
  lifetime: number;
  /** ± lifetime jitter, seconds (default 0). */
  lifetimeVariance?: number;
  /** Initial Transform scale (default 1). */
  startScale?: number;
  /** Fade-by-shrink target scale (default 0). */
  endScale?: number;
  /** Particle primitive radius, px (default 2). */
  radius?: number;
  /** Particle color, hex int (default `config.defaultColor`). */
  color?: number;
  /** Horizontal gravity, px/second² (default 0). */
  gravityX?: number;
  /** Vertical gravity, px/second² (default 0). */
  gravityY?: number;
  /** Whether the emitter starts emitting (default true). */
  enabled?: boolean;
};

/** One-shot burst parameters (no persistent emitter entity retained). */
export type BurstSpec = {
  /** Number of particles to emit instantly. */
  count: number;
  /** Emission direction, radians (default 0). */
  angle?: number;
  /** ± half-cone around `angle`, radians (default π → full circle). */
  spread?: number;
  /** Particle launch speed, px/second. */
  speed: number;
  /** ± speed jitter, px/second (default 0). */
  speedVariance?: number;
  /** Particle lifetime, seconds. */
  lifetime: number;
  /** ± lifetime jitter, seconds (default 0). */
  lifetimeVariance?: number;
  /** Initial Transform scale (default 1). */
  startScale?: number;
  /** Fade-by-shrink target scale (default 0). */
  endScale?: number;
  /** Particle primitive radius, px (default 2). */
  radius?: number;
  /** Particle color, hex int (default `config.defaultColor`). */
  color?: number;
  /** Horizontal gravity, px/second² (default 0). */
  gravityX?: number;
  /** Vertical gravity, px/second² (default 0). */
  gravityY?: number;
};

/** Options for a floating rising/fading number or text. */
export type FloatTextOptions = {
  /** Seconds the text lives before despawning (default 1). */
  lifetime?: number;
  /** Upward rise speed, px/second (default 40). */
  riseSpeed?: number;
  /** Initial alpha (default 1). */
  startAlpha?: number;
  /** Final alpha faded to (default 0). */
  endAlpha?: number;
  /** Text color, hex int (default `config.defaultColor`). */
  color?: number;
  /** Font size in px (default 16). */
  fontSize?: number;
};

/** Options for a Transform scale-pop. */
export type PopOptions = {
  /** Peak scale multiplier at the pop's apex (default 1.3). */
  scale?: number;
  /** Pop duration, seconds (default 0.15). */
  duration?: number;
};

/** The vfx plugin public API (exposed as `app.vfx`). */
export type Api = {
  /**
   * Spawn a persistent emitter entity (Emitter component + Transform at x/y) and
   * return its handle. Move it by writing its Transform; despawn it via
   * {@link Api.removeEmitter}.
   *
   * @param spec - The persistent emitter parameters.
   * @returns The emitter entity handle.
   */
  createEmitter(spec: EmitterSpec): Entity;
  /**
   * Shallow-merge new emission parameters into a live emitter. No-op for a
   * dead / non-emitter entity.
   *
   * @param emitter - The emitter entity to reconfigure.
   * @param patch - The emission parameters to merge.
   */
  configureEmitter(emitter: Entity, patch: Partial<EmitterSpec>): void;
  /**
   * Pause/resume emission without despawning (keeps existing particles alive).
   *
   * @param emitter - The emitter entity.
   * @param enabled - Whether the emitter should emit.
   */
  setEmitterEnabled(emitter: Entity, enabled: boolean): void;
  /**
   * Despawn an emitter AND its currently-live particles (clean ECS teardown).
   *
   * @param emitter - The emitter entity to remove.
   */
  removeEmitter(emitter: Entity): void;
  /**
   * Emit `count` particles instantly at (x, y) — hit sparks, explosions, pickups.
   * Respects the global `maxParticles` cap.
   *
   * @param x - World-space X to emit at.
   * @param y - World-space Y to emit at.
   * @param spec - The one-shot burst parameters.
   */
  burst(x: number, y: number, spec: BurstSpec): void;
  /**
   * Add screen-shake trauma (0..1, clamped). Larger `amplitude`/`duration` =
   * stronger/longer. Multiple calls accumulate trauma; it decays automatically
   * to zero.
   *
   * @param amplitude - Trauma intensity contribution, 0..1.
   * @param duration - Rough seconds the shake should persist.
   */
  shake(amplitude: number, duration: number): void;
  /**
   * Immediately clear all shake trauma and reset the stage offset to (0, 0).
   */
  stopShake(): void;
  /**
   * Scale-pop an entity's Transform (hit/pickup juice): pops to `scale`× then
   * eases back. Requires a Transform on the entity; no-op otherwise. Re-calling
   * refreshes the pop.
   *
   * @param entity - The entity to pop.
   * @param opts - Optional peak scale + duration.
   */
  pop(entity: Entity, opts?: PopOptions): void;
  /**
   * Spawn a rising, alpha-fading floating number/text at (x, y). Returns the
   * entity handle (despawns itself after `lifetime`).
   *
   * @param x - World-space X.
   * @param y - World-space Y.
   * @param text - The string to display.
   * @param opts - Optional lifetime / rise / alpha / color / font size.
   * @returns The floating-text entity handle.
   */
  floatText(x: number, y: number, text: string, opts?: FloatTextOptions): Entity;
  /**
   * Pure easing curves `f(t): [0,1]→[0,1]` — reused by vfx systems and exported
   * for consumer juice (and a future `tween` plugin).
   */
  readonly easing: Readonly<Record<EasingName, (t: number) => number>>;
  /**
   * Linear interpolation `a + (b − a) * t`.
   *
   * @param a - Start value.
   * @param b - End value.
   * @param t - Interpolant, typically 0..1.
   * @returns The interpolated value.
   */
  lerp(a: number, b: number, t: number): number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared structural dependency types (reused by api.ts + systems/*)
// ─────────────────────────────────────────────────────────────────────────────

/** Logger surface injected by the common logPlugin (`ctx.log`). */
export type Log = {
  /** Log at debug level. */
  debug(message: string): void;
  /** Log at info level. */
  info(message: string): void;
  /** Log a warning. */
  warn(message: string): void;
  /** Log an error. */
  error(message: string): void;
};

/**
 * The slice of the renderer API vfx systems + API methods actually call. A
 * structural type (rather than the full renderer `Api`) so unit tests can pass a
 * minimal mock. Particles are staged via `attachPrimitive`; floating-text `Text`
 * via `attach`; `markDirty` repaints after a Transform write; `getStage` gates
 * headless view creation + carries the shake offset.
 */
export type RendererDep = {
  /** Stage a plain-data primitive view for an entity; `false` when headless. */
  attachPrimitive(entity: Entity, spec: PrimitiveSpec): boolean;
  /** Attach a Pixi Container (floating-text Text) for an entity. */
  attach(entity: Entity, view: Container): void;
  /** Mark an entity's view dirty so the sync system repositions it next tick. */
  markDirty(entity: Entity): void;
  /** The root stage Container, or undefined when headless / before start. */
  getStage(): Container | undefined;
};

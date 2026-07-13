/**
 * @file vfx plugin — onStart lifecycle wiring.
 *
 * `start` is the one place — after ecs/scheduler/renderer have started (guaranteed
 * by `depends` order) — to (1) capture `renderer.Transform` into state (reading it
 * earlier throws, per the renderer contract), (2) define the five named vfx
 * components (`Emitter`/`Particle`/`Pop`/`Flash`/`FloatingText`) so they exist
 * before any spawn and are MCP-introspectable by name, and (3) register the six
 * effect systems (emit/particle/pop/flash/floating in `"update"`, shake in `"render"`).
 *
 * This is deps-ready wiring — the renderer's own onStart shape — NOT a per-frame
 * or resource-owning path. There is no onStop: every effect view is renderer-owned
 * (via `attach`/`attachPrimitive`), so the renderer disposes them; vfx's own state
 * is plain GC-able data.
 */
import { ecsPlugin } from "../ecs";
import type { World } from "../ecs/types";
import { rendererPlugin } from "../renderer";
import type { Api as RendererApi } from "../renderer/types";
import { schedulerPlugin } from "../scheduler";
import type { Api as SchedulerApi } from "../scheduler/types";
import { createEmitSystem, DEAD_ENTITY } from "./systems/emit";
import { createFlashSystem } from "./systems/flash";
import { createFloatingSystem } from "./systems/floating";
import { createParticleSystem } from "./systems/particles";
import { createPopSystem } from "./systems/pop";
import { createShakeSystem } from "./systems/shake";
import type {
  Config,
  EmitterValue,
  FlashValue,
  FloatingTextValue,
  Log,
  ParticleValue,
  PopValue,
  State
} from "./types";

/**
 * Structural context required by {@link start}. Only the fields onStart accesses,
 * so unit tests can pass a minimal mock without wiring the full kernel.
 */
export type StartContext = {
  /** Resolved vfx configuration (default color + cap + shake tuning). */
  readonly config: Readonly<Config>;
  /** vfx plugin state (mutated to store the captured/defined tokens). */
  readonly state: State;
  /** Logger from logPlugin (passed to the emit system's cap notice). */
  readonly log: Log;
  /** Require a dependency's API by plugin instance (`ecs` / `scheduler` / `renderer`). */
  require: ((plugin: typeof ecsPlugin) => World) &
    ((plugin: typeof schedulerPlugin) => SchedulerApi) &
    ((plugin: typeof rendererPlugin) => RendererApi);
};

// ─────────────────────────────────────────────────────────────────────────────
// Component default-value factories (merge base for `add`; spawns pass full values)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default `EmitterValue` (disabled, zero-rate) — the merge base if an emitter is
 * ever `add`ed rather than spawned. Color falls back to `config.defaultColor`.
 *
 * @param config - Resolved vfx config (for the default color).
 * @returns A fresh default emitter value.
 * @example
 * ```ts
 * const value = createEmitterDefault(config);
 * ```
 */
const createEmitterDefault = (config: Readonly<Config>): EmitterValue => ({
  enabled: false,
  rate: 0,
  accumulator: 0,
  angle: 0,
  spread: 0,
  speed: 0,
  speedVariance: 0,
  lifetime: 0,
  lifetimeVariance: 0,
  startScale: 1,
  endScale: 0,
  radius: 2,
  color: config.defaultColor,
  gravityX: 0,
  gravityY: 0
});

/**
 * Default `ParticleValue` — the merge base; live particles are always spawned
 * with complete values by the emission core.
 *
 * @returns A fresh default particle value (unowned).
 * @example
 * ```ts
 * const value = createParticleDefault();
 * ```
 */
const createParticleDefault = (): ParticleValue => ({
  vx: 0,
  vy: 0,
  age: 0,
  lifetime: 1,
  startScale: 1,
  endScale: 0,
  gravityX: 0,
  gravityY: 0,
  emitter: DEAD_ENTITY
});

/**
 * Default `PopValue` — the merge base for `pop()`'s `add`.
 *
 * @returns A fresh default pop value (identity scale).
 * @example
 * ```ts
 * const value = createPopDefault();
 * ```
 */
const createPopDefault = (): PopValue => ({
  age: 0,
  duration: 0,
  amplitude: 1,
  baseScaleX: 1,
  baseScaleY: 1
});

/**
 * Default `FlashValue` — the merge base for `flash()`'s `add`. White = no tint.
 *
 * @returns A fresh default flash value (no-op white tint).
 * @example
 * ```ts
 * const value = createFlashDefault();
 * ```
 */
const createFlashDefault = (): FlashValue => ({
  age: 0,
  duration: 0,
  color: 0xff_ff_ff,
  baseTint: 0xff_ff_ff
});

/**
 * Default `FloatingTextValue` — the merge base; floating text is spawned with
 * complete values by `floatText()`.
 *
 * @returns A fresh default floating-text value.
 * @example
 * ```ts
 * const value = createFloatingTextDefault();
 * ```
 */
const createFloatingTextDefault = (): FloatingTextValue => ({
  age: 0,
  lifetime: 1,
  riseSpeed: 40,
  startAlpha: 1,
  endAlpha: 0
});

// ─────────────────────────────────────────────────────────────────────────────
// onStart
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Starts the vfx plugin: captures the renderer's Transform token, defines the
 * five named vfx components on the ECS world, and registers the six effect
 * systems with the scheduler. Runs identically headless — only Pixi view creation
 * (inside the renderer) is gated on a live stage.
 *
 * @param ctx - Structural start context (config, state, log, require).
 * @example
 * ```ts
 * start(ctx); // after ecs/scheduler/renderer have started
 * ```
 */
export const start = (ctx: StartContext): void => {
  const world = ctx.require(ecsPlugin);
  const scheduler = ctx.require(schedulerPlugin);
  const renderer = ctx.require(rendererPlugin);

  // (1) Capture the renderer's Transform token (reading it before start throws).
  const transform = renderer.Transform;
  ctx.state.transform = transform;

  // (2) Define the five named vfx components (introspectable by name via MCP).
  const Emitter = world.defineComponent<EmitterValue>(() => createEmitterDefault(ctx.config), {
    name: "Emitter"
  });
  const Particle = world.defineComponent<ParticleValue>(createParticleDefault, {
    name: "Particle"
  });
  const Pop = world.defineComponent<PopValue>(createPopDefault, { name: "Pop" });
  const Flash = world.defineComponent<FlashValue>(createFlashDefault, { name: "Flash" });
  const FloatingText = world.defineComponent<FloatingTextValue>(createFloatingTextDefault, {
    name: "FloatingText"
  });
  ctx.state.Emitter = Emitter;
  ctx.state.Particle = Particle;
  ctx.state.Pop = Pop;
  ctx.state.Flash = Flash;
  ctx.state.FloatingText = FloatingText;

  // The renderer API is structurally a `RendererDep` (superset), so it is passed
  // directly to the systems + emission core — no wrapper object needed.

  // (3) Register the six effect systems.
  scheduler.addSystem(
    "update",
    createEmitSystem({
      world,
      transform,
      Emitter,
      Particle,
      renderer,
      state: ctx.state,
      config: ctx.config,
      log: ctx.log,
      random: Math.random
    })
  );
  scheduler.addSystem(
    "update",
    createParticleSystem({ world, transform, Particle, renderer, state: ctx.state })
  );
  scheduler.addSystem("update", createPopSystem({ world, transform, Pop, renderer }));
  scheduler.addSystem("update", createFlashSystem({ world, Flash, renderer }));
  scheduler.addSystem(
    "update",
    createFloatingSystem({
      world,
      transform,
      FloatingText,
      renderer,
      state: ctx.state
    })
  );
  scheduler.addSystem(
    "render",
    createShakeSystem({
      renderer,
      config: ctx.config,
      state: ctx.state,
      random: Math.random
    })
  );
};

/**
 * @file loop plugin — type definitions.
 */
import type { Resource } from "../ecs/types";

/**
 * Frame clock published as the `Time` world resource.
 * Updated once per fixed step — before each `scheduler.tick(dt)` call.
 *
 * Consumer-facing fields are `readonly`; the loop mutates the backing object
 * in place (it holds a mutable reference internally) so there is no per-step
 * allocation.
 */
export type TimeState = {
  /**
   * Fixed timestep of the current step, in seconds.
   * Always equals `config.fixedDt` — every step advances by the same amount.
   */
  readonly dt: number;
  /**
   * Total simulated time since the loop started, in seconds.
   * Sum of all fixed steps executed so far.
   */
  readonly elapsed: number;
  /**
   * Number of fixed steps simulated since the loop started (1-based during a step).
   * Incremented once per fixed-step tick.
   */
  readonly frame: number;
};

/** loop plugin configuration. */
export type Config = {
  /** Fixed simulation step (seconds). `@default 1/60` */
  fixedDt: number;
  /** Max real delta consumed per frame before clamping (seconds). `@default 0.25` */
  maxFrameDelta: number;
  /** Max fixed steps simulated per frame. `@default 5` */
  maxStepsPerFrame: number;
  /** Auto-start the rAF loop on plugin start. `@default true` */
  autoStart: boolean;
};

/** loop plugin state. */
export type State = {
  /** Whether the loop is running. */
  running: boolean;
  /** Time accumulator (seconds) for fixed stepping. */
  accumulator: number;
  /** Timestamp (ms) of the previous frame, or undefined when not yet set. */
  lastTime: number | undefined;
};

/** loop plugin API. */
export type Api = {
  /** Start the rAF loop (no-op if running). */
  start(): void;
  /** Stop the rAF loop and cancel the pending frame. */
  stop(): void;
  /** True while the loop is running. */
  isRunning(): boolean;
  /**
   * Advance exactly one fixed step + render (tests / mcp loop:step).
   * Also advances the `Time` resource: `dt = fixedDt`, `elapsed += fixedDt`, `frame += 1`.
   */
  step(): void;
  /**
   * Well-known `Time` resource token.
   *
   * Pass to `world.resource(app.loop.time)` from any system or test to read the
   * current `dt`, `elapsed`, and `frame` values. The object is mutated in place
   * each fixed step — no new allocation occurs at runtime.
   */
  readonly time: Resource<TimeState>;
};

/**
 * @file loop plugin — type definitions.
 */

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
  /** Timestamp (ms) of the previous frame, or null. */
  lastTime: number | null;
};

/** loop plugin API. */
export type Api = {
  /** Start the rAF loop (no-op if running). */
  start(): void;
  /** Stop the rAF loop and cancel the pending frame. */
  stop(): void;
  /** True while the loop is running. */
  isRunning(): boolean;
  /** Advance exactly one fixed step + render (tests / mcp loop:step). */
  step(): void;
};

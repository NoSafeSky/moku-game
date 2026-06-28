/**
 * @file loop plugin — API factory.
 *
 * Exposes the loop public surface: start, stop, isRunning, and step.
 *
 * start/stop read the per-instance LoopRuntime from the module-level WeakMap
 * (exported from lifecycle.ts) via ctx.global so they can schedule/cancel the
 * rAF loop without needing the full lifecycle context.
 *
 * step() performs one deterministic fixed step + render for tests and the
 * mcp `loop:step` tool, bypassing real-time accumulation entirely.
 */
import type { rendererPlugin } from "../renderer";
import type { schedulerPlugin } from "../scheduler";
import { loopRegistry } from "./lifecycle";
import { Time } from "./resources";
import type { Api, Config, State, TimeStepResult } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Context type (structural — only fields actually accessed)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Structural context type required by createApi.
 *
 * Only the fields the API factory actually accesses are listed so unit tests
 * can supply a minimal mock without wiring the full kernel context.
 */
export type LoopContext = {
  /** Resolved loop configuration. */
  readonly config: Readonly<Config>;
  /** Loop plugin state (running, accumulator, lastTime). */
  readonly state: State;
  /** Global plugin registry — key for the module-level WeakMap. */
  readonly global: object;
  /** Require a dependency's API by plugin instance. */
  require: ((plugin: typeof schedulerPlugin) => { tick(dt: number): void }) &
    ((plugin: typeof rendererPlugin) => { render(): void });
};

// ─────────────────────────────────────────────────────────────────────────────
// API factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates the loop plugin API surface.
 *
 * The four methods delegate to the LoopRuntime stored in the module WeakMap;
 * they are safe to call at any time (before onStart or after onStop the WeakMap
 * has no entry, so start/stop/step are no-ops, and isRunning reflects state).
 *
 * @param ctx - Plugin context supplying config, state, global, and require.
 * @param ctx.config - Resolved loop configuration (fixedDt, autoStart, etc.).
 * @param ctx.state - Loop plugin state (running, accumulator, lastTime).
 * @param ctx.global - Global plugin registry (key for the module WeakMap).
 * @param ctx.require - Kernel function to obtain dependency APIs.
 * @returns The loop {@link Api} object.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * api.start();         // begin the rAF loop
 * api.isRunning();     // → true
 * api.step();          // advance one deterministic step
 * api.stop();          // halt the loop
 * ```
 */
export const createApi = (ctx: LoopContext): Api => {
  return {
    /**
     * Start the rAF loop. No-op if already running.
     *
     * Resets `accumulator` and `lastTime` so a fresh stop → start cycle does
     * not carry stale time into the first frame.
     *
     * @example
     * ```ts
     * api.start();
     * ```
     */
    start(): void {
      if (ctx.state.running) return;

      const runtime = loopRegistry.get(ctx.global);
      if (!runtime) return;

      ctx.state.running = true;
      ctx.state.accumulator = 0;
      ctx.state.lastTime = undefined;
      runtime.scheduleFrame();
    },

    /**
     * Stop the rAF loop and cancel the pending frame. No-op if not running.
     *
     * @example
     * ```ts
     * api.stop();
     * ```
     */
    stop(): void {
      if (!ctx.state.running) return;

      const runtime = loopRegistry.get(ctx.global);
      if (!runtime) return;

      ctx.state.running = false;

      if (runtime.rafId !== undefined) {
        const caf = (globalThis as { cancelAnimationFrame?: (id: number) => void })
          .cancelAnimationFrame;
        caf?.(runtime.rafId);
        runtime.rafId = undefined;
      }
    },

    /**
     * Returns true while the rAF loop is running, false otherwise.
     *
     * @returns Whether the loop is currently running.
     * @example
     * ```ts
     * if (api.isRunning()) api.stop();
     * ```
     */
    isRunning(): boolean {
      return ctx.state.running;
    },

    /**
     * Advance exactly one fixed step and render once.
     *
     * Updates the `Time` resource (`dt = fixedDt`, `elapsed += fixedDt`, `frame += 1`)
     * immediately before calling `scheduler.tick(fixedDt)`, then calls `renderer.render()`.
     * Bypasses real-time accumulation — useful for tests, frame-stepping tools, and the
     * mcp `loop:step` command.
     *
     * Returns a snapshot of the just-advanced clock `{ frame, elapsed, dt }`. A no-runtime
     * call (before `start()` / after `stop()`) returns `{ frame: 0, elapsed: 0, dt: 0 }`.
     *
     * @returns The {@link TimeStepResult} snapshot of the frame clock after this step.
     * @example
     * ```ts
     * const { frame, elapsed, dt } = api.step(); // deterministic single-step advance
     * ```
     */
    step(): TimeStepResult {
      const runtime = loopRegistry.get(ctx.global);
      if (!runtime) return { frame: 0, elapsed: 0, dt: 0 };

      runtime.time.dt = ctx.config.fixedDt;
      runtime.time.elapsed += ctx.config.fixedDt;
      runtime.time.frame += 1;
      runtime.tickFunction(ctx.config.fixedDt);
      runtime.renderFunction();

      return { frame: runtime.time.frame, elapsed: runtime.time.elapsed, dt: runtime.time.dt };
    },

    /**
     * Well-known `Time` resource token.
     *
     * Pass to `world.resource(app.loop.time)` from any system or test to read
     * the current `dt`, `elapsed`, and `frame` values for the executing step.
     * The underlying object is mutated in place — no new allocation per step.
     *
     * @example
     * ```ts
     * const clock = world.resource(app.loop.time);
     * // → { dt: 0.016, elapsed: 1.23, frame: 74 }
     * ```
     */
    time: Time
  };
};

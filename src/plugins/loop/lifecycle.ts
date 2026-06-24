/**
 * @file loop plugin — onStart / onStop lifecycle handlers.
 *
 * onStart: captures scheduler.tick and renderer.render via ctx.require, builds
 *   the frame callback (fixed-timestep accumulator with delta clamp and step cap),
 *   registers a visibilitychange listener that resets the accumulator on tab-return,
 *   and stores a LoopRuntime entry in a module-level WeakMap keyed on ctx.global.
 *   If autoStart is true it also schedules the first requestAnimationFrame.
 *
 * onStop: reads the LoopRuntime from the WeakMap via ctx.global (TeardownContext
 *   only exposes { global } — state is inaccessible), cancels the pending rAF,
 *   removes the visibilitychange listener, and deletes the WeakMap entry.
 *   Idempotent: a second call with the same ctx.global is a safe no-op.
 */
import { rendererPlugin } from "../renderer";
import { schedulerPlugin } from "../scheduler";
import type { Config, State } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Structural globalThis alias (degrade gracefully in headless Node)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Structural view of globalThis exposing the optional DOM surface used by the
 * loop plugin. Both fields are optional so the plugin degrades gracefully in
 * headless / non-browser runtimes.
 */
type GlobalWithRaf = {
  /** Browser rAF — schedules the next frame callback. */
  requestAnimationFrame?: (cb: (t: number) => void) => number;
  /** Browser cancelAF — cancels a pending rAF by id. */
  cancelAnimationFrame?: (id: number) => void;
  /** The DOM document, used to register the visibilitychange handler. */
  document?: {
    addEventListener(type: string, fn: () => void): void;
    removeEventListener(type: string, fn: () => void): void;
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Per-instance runtime (stored in the WeakMap)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runtime data stored per plugin instance, keyed on ctx.global.
 * Shared between lifecycle.ts and api.ts via the exported loopRegistry.
 */
export type LoopRuntime = {
  /** Pending rAF id, or undefined when no frame is scheduled. */
  rafId: number | undefined;
  /** The visibilitychange handler reference (needed to removeEventListener). */
  onVisibility: () => void;
  /** Bound scheduler.tick — called N times per frame. */
  tickFunction: (dt: number) => void;
  /** Bound renderer.render — called once per frame. */
  renderFunction: () => void;
  /** Resolved config for this plugin instance. */
  config: Readonly<Config>;
  /** Mutable state for this plugin instance. */
  state: State;
  /** Schedules the next rAF (shared by lifecycle start and api.start). */
  scheduleFrame: () => void;
};

/**
 * Module-level WeakMap: maps each plugin instance's frozen global registry to
 * its LoopRuntime. Exported so api.ts can read/update it without a second map.
 */
export const loopRegistry = new WeakMap<object, LoopRuntime>();

// ─────────────────────────────────────────────────────────────────────────────
// Context types (structural — only fields actually accessed)
// ─────────────────────────────────────────────────────────────────────────────

/** Context available in onStart (full PluginContext). */
type StartContext = {
  /** Resolved loop configuration. */
  readonly config: Readonly<Config>;
  /** Loop plugin state (mutated to track running / accumulator / lastTime). */
  readonly state: State;
  /** Global plugin registry — key for the WeakMap. */
  readonly global: object;
  /** Logger from logPlugin. */
  readonly log: {
    /** Log at info level. */
    info(message: string): void;
    /** Log a warning. */
    warn(message: string): void;
    /** Log an error. */
    error(message: string): void;
    /** Log at debug level. */
    debug(message: string): void;
  };
  /** Require a dependency's API by plugin instance. */
  require: ((plugin: typeof schedulerPlugin) => { tick(dt: number): void }) &
    ((plugin: typeof rendererPlugin) => { render(): void });
};

/** Context available in onStop (TeardownContext — global only). */
type StopContext = {
  /** Global plugin registry — key for the WeakMap. */
  readonly global: object;
};

// ─────────────────────────────────────────────────────────────────────────────
// Frame driver factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the rAF frame callback for the given runtime.
 *
 * The callback implements the fixed-timestep accumulator pattern:
 * 1. Compute real delta (seconds) from successive rAF timestamps.
 * 2. Clamp to `config.maxFrameDelta` to prevent spiral-of-death after tab-hide.
 * 3. Accumulate and step `scheduler.tick(fixedDt)` up to `maxStepsPerFrame` times.
 * 4. Call `renderer.render()` exactly once.
 * 5. Re-schedule itself with the next rAF call (unless stop() has been called).
 *
 * @param runtime - The per-instance LoopRuntime stored in the WeakMap.
 * @returns The rAF callback to pass to requestAnimationFrame.
 * @example
 * ```ts
 * const frameCb = buildFrameCallback(runtime);
 * runtime.rafId = requestAnimationFrame(frameCb);
 * ```
 */
const buildFrameCallback = (runtime: LoopRuntime): ((timestamp: number) => void) => {
  return (timestamp: number) => {
    // Guard: stop() may have been called between the rAF schedule and this callback
    if (!runtime.state.running) return;

    const { config, state } = runtime;

    // ── Compute delta ────────────────────────────────────────────────────────
    if (state.lastTime === undefined) {
      // First frame: seed lastTime, do not tick, schedule next
      state.lastTime = timestamp;
      runtime.scheduleFrame();
      return;
    }

    const rawDeltaMs = timestamp - state.lastTime;
    state.lastTime = timestamp;

    // Convert to seconds and clamp (spiral-of-death guard)
    const deltaSeconds = Math.min(rawDeltaMs / 1000, config.maxFrameDelta);

    // ── Fixed-step accumulation ──────────────────────────────────────────────
    state.accumulator += deltaSeconds;

    let steps = 0;
    while (state.accumulator >= config.fixedDt && steps < config.maxStepsPerFrame) {
      runtime.tickFunction(config.fixedDt);
      state.accumulator -= config.fixedDt;
      steps += 1;
    }

    // ── Render once per frame ────────────────────────────────────────────────
    runtime.renderFunction();

    // ── Re-schedule ──────────────────────────────────────────────────────────
    runtime.scheduleFrame();
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// onStart
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Starts the loop plugin: captures scheduler/renderer APIs, wires the
 * fixed-timestep frame driver, registers the visibilitychange reset handler,
 * and stores everything in the module WeakMap keyed on ctx.global.
 *
 * If `config.autoStart` is true, the rAF loop is also scheduled immediately.
 * Otherwise, the loop waits for an explicit `api.start()` call.
 *
 * @param ctx - Full plugin context providing config, state, global, log, and require.
 * @returns A Promise that resolves once the loop is wired (not when it stops).
 * @example
 * ```ts
 * await start(ctx);
 * ```
 */
export const start = async (ctx: StartContext): Promise<void> => {
  const scheduler = ctx.require(schedulerPlugin);
  const renderer = ctx.require(rendererPlugin);

  // ── Build per-instance LoopRuntime ──────────────────────────────────────

  /**
   * Forward scheduler.tick(dt) — stored in the runtime for hot-path calls.
   *
   * @param dt - Fixed timestep in seconds.
   * @example
   * ```ts
   * tickFunction(1 / 60);
   * ```
   */
  const tickFunction = (dt: number) => {
    scheduler.tick(dt);
  };

  /**
   * Forward renderer.render() — stored in the runtime for hot-path calls.
   *
   * @example
   * ```ts
   * renderFunction();
   * ```
   */
  const renderFunction = () => {
    renderer.render();
  };

  const runtime: LoopRuntime = {
    rafId: undefined,
    onVisibility: renderFunction, // placeholder — replaced below before addEventListener
    tickFunction,
    renderFunction,
    config: ctx.config,
    state: ctx.state,
    scheduleFrame: renderFunction // placeholder — replaced below before first use
  };

  // Build the frame callback (closes over `runtime`)
  const frameCallback = buildFrameCallback(runtime);

  /**
   * Schedule the next rAF and store the returned id in runtime.rafId.
   * Called by the frame callback to chain frames, and by api.start() to begin the loop.
   *
   * @example
   * ```ts
   * scheduleFrame();
   * ```
   */
  const scheduleFrame = () => {
    const raf = (globalThis as GlobalWithRaf).requestAnimationFrame;
    if (raf) runtime.rafId = raf(frameCallback);
  };

  /**
   * visibilitychange handler: reset accumulator + lastTime on tab-return to
   * prevent a large burst of catch-up ticks when the tab becomes visible again.
   *
   * @example
   * ```ts
   * document.addEventListener("visibilitychange", onVisibility);
   * ```
   */
  const onVisibility = () => {
    ctx.state.accumulator = 0;
    ctx.state.lastTime = undefined;
  };

  // Patch the runtime with the real implementations now that both closures exist
  runtime.scheduleFrame = scheduleFrame;
  runtime.onVisibility = onVisibility;

  // Register visibilitychange listener
  (globalThis as GlobalWithRaf).document?.addEventListener("visibilitychange", onVisibility);

  // Store in WeakMap so onStop (and api.ts) can reach it
  loopRegistry.set(ctx.global, runtime);

  // Auto-start if configured
  if (ctx.config.autoStart) {
    ctx.state.running = true;
    ctx.state.accumulator = 0;
    ctx.state.lastTime = undefined;
    runtime.scheduleFrame();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// onStop
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stops the loop plugin: cancels the pending rAF, removes the visibilitychange
 * listener, sets `state.running` to false, and deletes the WeakMap entry.
 *
 * Reads teardown data from the module WeakMap via ctx.global because onStop
 * only receives TeardownContext ({ global }) — state is not accessible.
 * Idempotent: a second call with the same ctx.global is a safe no-op.
 *
 * @param ctx - Teardown context providing only the global registry.
 * @returns A Promise that resolves once teardown is complete.
 * @example
 * ```ts
 * await stop(ctx);
 * ```
 */
export const stop = async (ctx: StopContext): Promise<void> => {
  const runtime = loopRegistry.get(ctx.global);
  if (!runtime) return;

  // Cancel any pending rAF
  if (runtime.rafId !== undefined) {
    (globalThis as GlobalWithRaf).cancelAnimationFrame?.(runtime.rafId);
    runtime.rafId = undefined;
  }

  // Remove visibility listener
  (globalThis as GlobalWithRaf).document?.removeEventListener(
    "visibilitychange",
    runtime.onVisibility
  );

  // Mark stopped
  runtime.state.running = false;

  // Remove WeakMap entry so a second stop is a no-op
  loopRegistry.delete(ctx.global);
};

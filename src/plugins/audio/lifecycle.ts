/**
 * @file audio plugin — onStart / onStop lifecycle handlers.
 *
 * onStart: builds the audio engine (AudioContext + master/sfx/music gain graph)
 *   from config and stores it in the module WeakMap keyed on ctx.global. When no
 *   AudioContext exists (SSR / tests) a headless engine is recorded instead and
 *   every API method no-ops. The AudioContext is a real, long-lived browser
 *   resource — exactly the case onStart/onStop exist for (spec/06 §3).
 *
 * onStop: reads the engine from the WeakMap via ctx.global (TeardownContext
 *   exposes ONLY { global }), stops the active music source, closes the
 *   AudioContext, and deletes the WeakMap entry so a re-start() builds a fresh
 *   graph (spec/06 §4). Idempotent: a second call with the same ctx.global is a
 *   safe no-op.
 */
import { audioRegistry, createEngine, teardownEngine } from "./engine";
import type { Config, Log } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Context types (structural — only fields actually accessed)
// ─────────────────────────────────────────────────────────────────────────────

/** Context available in onStart (full PluginContext, subset used here). */
type StartContext = {
  /** Resolved audio configuration (initial volumes + mute + manifest). */
  readonly config: Readonly<Config>;
  /** Global plugin registry — key for the engine WeakMap. */
  readonly global: object;
  /** Logger from logPlugin. */
  readonly log: Log;
};

/** Context available in onStop (TeardownContext — global only). */
type StopContext = {
  /** Global plugin registry — key for the engine WeakMap. */
  readonly global: object;
};

// ─────────────────────────────────────────────────────────────────────────────
// onStart
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Starts the audio plugin: builds the engine from config and stores it in the
 * module WeakMap keyed on `ctx.global`. Logs an info line when headless so the
 * no-op behaviour is visible in server/test runs.
 *
 * @param ctx - Plugin context providing config, global, and log.
 * @returns A Promise that resolves once the engine is built and registered.
 * @example
 * ```ts
 * await start(ctx);
 * ```
 */
export const start = async (ctx: StartContext): Promise<void> => {
  const engine = createEngine(ctx.config, ctx.log);
  audioRegistry.set(ctx.global, engine);

  if (engine.headless) {
    ctx.log.info("[audio] headless — AudioContext unavailable; audio methods no-op.");
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// onStop
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stops the audio plugin: stops the active music source, closes the
 * AudioContext, and removes the WeakMap entry. Reads the engine from the module
 * WeakMap via `ctx.global` because onStop only receives TeardownContext
 * (`{ global }`). Idempotent — a second call with the same global is a safe no-op.
 *
 * @param ctx - Teardown context providing only the global registry.
 * @returns A Promise that resolves once the AudioContext is closed.
 * @example
 * ```ts
 * await stop(ctx);
 * ```
 */
export const stop = async (ctx: StopContext): Promise<void> => {
  const engine = audioRegistry.get(ctx.global);
  if (!engine) return;

  await teardownEngine(engine);
  audioRegistry.delete(ctx.global);
};

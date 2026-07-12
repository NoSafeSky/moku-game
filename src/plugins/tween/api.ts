/**
 * @file tween plugin — API factory (the `app.tween` surface).
 *
 * Exposes object tweens (`to`/`from`), scalar tweens (`value`), `killAll`/`count`,
 * and the shared `easing`/`lerp` helpers. Every creator is a guarded no-op before
 * onStart and over the `maxActive` cap — it warns and returns a dead handle rather
 * than throwing on the hot path. The API never calls a dependency at call time (the
 * only dependency call, `scheduler.addSystem`, happens once in onStart), so its
 * context is just `{ config, state, log }`.
 */
import { easing, lerp } from "./easing";
import type {
  Api,
  Config,
  Easing,
  Log,
  NumericProperties,
  State,
  TweenHandle,
  TweenOptions,
  TweenRecord,
  ValueTweenOptions
} from "./types";

/**
 * Structural context required by {@link createApi}, so unit tests can pass a
 * minimal mock without wiring the full kernel. Mirrors the scheduler/vfx pattern.
 */
export type TweenApiContext = {
  /** Resolved tween configuration (defaults + stage + cap). */
  readonly config: Readonly<Config>;
  /** tween plugin state — the active-tween registry, id source, and started guard. */
  readonly state: State;
  /** Logger from logPlugin (before-start + cap + non-finite notices). */
  readonly log: Log;
};

/** A plain object viewed as its numeric properties — the tween capture/write surface. */
type NumericRecord = Record<string, number>;

/** One captured property to interpolate: its key and its start → end numbers. */
type Captured = { readonly key: string; readonly start: number; readonly end: number };

/** Duration floor (seconds): coerces a `duration: 0` up so `t` resolves to 1 on the first tick. */
const EPS = 1e-6;

/**
 * A shared inert no-op used for the dead handle's stop/pause/resume and as the
 * placeholder settle before the Promise executor assigns the real resolver.
 *
 * @returns Nothing.
 * @example
 * ```ts
 * let settle: () => void = inert;
 * ```
 */
const inert = (): void => undefined;

/**
 * A shared, already-settled dead handle returned by the before-start and over-cap
 * guards — inert methods, `active: false`, and an already-resolved `done`.
 */
const DEAD_HANDLE: TweenHandle = {
  stop: inert,
  pause: inert,
  resume: inert,
  active: false,
  done: Promise.resolve()
};

/**
 * View a tween target/props object as a numeric record. `NumericProperties<T>`
 * already constrains callers to numeric keys at compile time; runtime
 * `isFiniteNumber` checks re-validate each value before it is captured or written.
 *
 * @param source - The target or props object.
 * @returns The same object typed as a numeric record.
 * @example
 * ```ts
 * const holder = asNumeric(target);
 * ```
 */
const asNumeric = (source: object): NumericRecord => source as NumericRecord;

/**
 * Whether `v` is a real finite number (guards against non-numeric or NaN/Infinity
 * property values — those are skipped, not tweened).
 *
 * @param v - The candidate value (possibly undefined under `noUncheckedIndexedAccess`).
 * @returns `true` when `v` is a finite number.
 * @example
 * ```ts
 * isFiniteNumber(Number.NaN); // false
 * ```
 */
const isFiniteNumber = (v: number | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

/**
 * Resolve an easing spec to a concrete curve function (a name → table lookup; a
 * custom function is used as-is).
 *
 * @param spec - A built-in curve name or a custom `(t) => number`.
 * @returns The concrete easing function.
 * @example
 * ```ts
 * resolveEasing("easeOutCubic")(0.5); // 0.875
 * ```
 */
const resolveEasing = (spec: Easing): ((t: number) => number) =>
  typeof spec === "function" ? spec : easing[spec];

/**
 * Build the per-frame `apply` closure for an object tween: lerp each captured key
 * into `holder`, then forward eased progress to `onUpdate`.
 *
 * @param holder - The target object (numeric view) to mutate.
 * @param captured - The properties + their start/end values captured at creation.
 * @param onUpdate - Optional per-frame progress callback (eased 0..1).
 * @returns The `apply(eased)` function stored on the tween record.
 * @example
 * ```ts
 * const apply = makeApply(holder, captured, opts.onUpdate);
 * ```
 */
const makeApply =
  (holder: NumericRecord, captured: readonly Captured[], onUpdate?: (progress: number) => void) =>
  (eased: number): void => {
    for (const c of captured) holder[c.key] = lerp(c.start, c.end, eased);
    onUpdate?.(eased);
  };

/**
 * Capture `to` targets: start = the current value on `holder`, end = the requested
 * value in `props`. Non-finite start OR end skips that property (debug-logged).
 *
 * @param holder - The target object (numeric view).
 * @param props - The requested end values.
 * @param log - Logger for the skip notice.
 * @returns The captured start → end pairs.
 * @example
 * ```ts
 * const captured = captureTo(holder, props, log);
 * ```
 */
const captureTo = (holder: NumericRecord, props: NumericRecord, log: Log): Captured[] => {
  const captured: Captured[] = [];
  for (const key of Object.keys(props)) {
    const start = holder[key];
    const end = props[key];
    if (!isFiniteNumber(start) || !isFiniteNumber(end)) {
      log.debug(`[tween] to skipped non-finite property "${key}".`);
      continue;
    }
    captured.push({ key, start, end });
  }
  return captured;
};

/**
 * Capture `from` targets: start = the requested "from" value in `props`, end = the
 * current value on `holder` (the destination). The from-value is written to
 * `holder` immediately. Non-finite start OR end skips that property (debug-logged).
 *
 * @param holder - The target object (numeric view), mutated to the from-values now.
 * @param props - The requested "from" values.
 * @param log - Logger for the skip notice.
 * @returns The captured start → end pairs.
 * @example
 * ```ts
 * const captured = captureFrom(holder, props, log);
 * ```
 */
const captureFrom = (holder: NumericRecord, props: NumericRecord, log: Log): Captured[] => {
  const captured: Captured[] = [];
  for (const key of Object.keys(props)) {
    const start = props[key];
    const end = holder[key];
    if (!isFiniteNumber(start) || !isFiniteNumber(end)) {
      log.debug(`[tween] from skipped non-finite property "${key}".`);
      continue;
    }
    holder[key] = start; // apply the "from" value immediately
    captured.push({ key, start, end });
  }
  return captured;
};

/**
 * Creates the tween plugin API surface.
 *
 * @param ctx - Plugin context (structural — only `config`, `state`, `log`).
 * @param ctx.config - Resolved tween configuration.
 * @param ctx.state - tween plugin state (registry, id source, started guard).
 * @param ctx.log - Logger from logPlugin.
 * @returns The tween plugin {@link Api} object.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * api.to(sprite, { x: 500 }, { duration: 0.4, easing: "easeOutBack" });
 * ```
 */
export const createApi = (ctx: TweenApiContext): Api => {
  /**
   * Guard a creator against before-start and over-cap conditions.
   *
   * @param method - The creator name, for the warning message.
   * @returns A dead handle to return when guarded, or `undefined` to proceed.
   * @example
   * ```ts
   * const dead = guardCreate("to");
   * if (dead) return dead;
   * ```
   */
  const guardCreate = (method: string): TweenHandle | undefined => {
    if (!ctx.state.started) {
      ctx.log.warn(`[tween] ${method} called before start — no tween created.`);
      return DEAD_HANDLE;
    }
    if (ctx.state.tweens.size >= ctx.config.maxActive) {
      ctx.log.warn(
        `[tween] ${method} exceeded maxActive (${ctx.config.maxActive}) — no tween created.`
      );
      return DEAD_HANDLE;
    }
    return undefined;
  };

  /**
   * Build the live control handle for the tween stored under `id`.
   *
   * @param id - The registry key of the tween.
   * @param done - The tween's settle Promise.
   * @returns A {@link TweenHandle} closing over the registry.
   * @example
   * ```ts
   * const handle = makeHandle(id, done);
   * ```
   */
  const makeHandle = (id: number, done: Promise<void>): TweenHandle => ({
    /**
     * Cancel the tween now (no `onComplete`), settle `done`. Idempotent.
     *
     * @example
     * ```ts
     * handle.stop();
     * ```
     */
    stop(): void {
      const record = ctx.state.tweens.get(id);
      if (!record) return; // already completed or stopped — done is settled
      ctx.state.tweens.delete(id);
      record.settle();
    },
    /**
     * Freeze advancement until `resume`. Idempotent.
     *
     * @example
     * ```ts
     * handle.pause();
     * ```
     */
    pause(): void {
      const record = ctx.state.tweens.get(id);
      if (record) record.paused = true;
    },
    /**
     * Resume a paused tween. Idempotent.
     *
     * @example
     * ```ts
     * handle.resume();
     * ```
     */
    resume(): void {
      const record = ctx.state.tweens.get(id);
      if (record) record.paused = false;
    },
    /**
     * True while the tween is still registered (not completed/stopped).
     *
     * @returns Whether the tween is active.
     * @example
     * ```ts
     * if (handle.active) handle.stop();
     * ```
     */
    get active(): boolean {
      return ctx.state.tweens.has(id);
    },
    done
  });

  /**
   * Register a tween record from a built `apply` closure + resolved options, and
   * return its control handle.
   *
   * @param apply - The per-frame closure that mutates the target / drives onUpdate.
   * @param opts - The tween options (duration / easing / delay / repeat / yoyo / onComplete).
   * @returns A {@link TweenHandle} controlling the new tween.
   * @example
   * ```ts
   * return register(makeApply(holder, captured, opts.onUpdate), opts);
   * ```
   */
  const register = (apply: (eased: number) => void, opts: TweenOptions): TweenHandle => {
    // Resolve the effective duration + easing for this tween (config defaults fill gaps).
    const duration = Math.max(EPS, opts.duration ?? ctx.config.defaultDuration);
    const easingFunction = resolveEasing(opts.easing ?? ctx.config.defaultEasing);

    // The Promise executor runs synchronously, so `settle` is assigned before use.
    let settle: () => void = inert;
    const done = new Promise<void>(resolve => {
      settle = resolve;
    });

    // Assign an id and register the record so the advance system picks it up next tick.
    const id = ctx.state.nextId++;
    const record: TweenRecord = {
      delayRemaining: opts.delay ?? 0,
      elapsed: 0,
      duration,
      easingFunction,
      apply,
      repeatRemaining: opts.repeat ?? 0,
      yoyo: opts.yoyo ?? false,
      iteration: 0,
      paused: false,
      onComplete: opts.onComplete,
      settle
    };
    ctx.state.tweens.set(id, record);

    return makeHandle(id, done);
  };

  return {
    /**
     * Tween the numeric props of `target` to the given values (mutating `target`).
     * Guarded no-op → dead handle before start / over the cap.
     *
     * @param target - The plain mutable object to animate.
     * @param props - The numeric keys of `target` and their target values.
     * @param opts - Optional duration / easing / delay / repeat / yoyo / callbacks.
     * @returns A {@link TweenHandle} controlling the running tween.
     * @example
     * ```ts
     * api.to(camera, { x: 640, y: 360 }, { duration: 0.6 });
     * ```
     */
    to<T extends object>(
      target: T,
      props: NumericProperties<T>,
      opts: TweenOptions = {}
    ): TweenHandle {
      const dead = guardCreate("to");
      if (dead) return dead;

      const holder = asNumeric(target);
      const captured = captureTo(holder, asNumeric(props), ctx.log);
      return register(makeApply(holder, captured, opts.onUpdate), opts);
    },

    /**
     * Tween the numeric props of `target` FROM the given values to their current
     * values (the from-values are applied immediately). Guarded no-op → dead handle
     * before start / over the cap.
     *
     * @param target - The plain mutable object to animate.
     * @param props - The numeric keys of `target` and their starting ("from") values.
     * @param opts - Optional duration / easing / delay / repeat / yoyo / callbacks.
     * @returns A {@link TweenHandle} controlling the running tween.
     * @example
     * ```ts
     * api.from(card, { y: -200 }, { duration: 0.4, easing: "easeOutBack" });
     * ```
     */
    from<T extends object>(
      target: T,
      props: NumericProperties<T>,
      opts: TweenOptions = {}
    ): TweenHandle {
      const dead = guardCreate("from");
      if (dead) return dead;

      const holder = asNumeric(target);
      const captured = captureFrom(holder, asNumeric(props), ctx.log);
      return register(makeApply(holder, captured, opts.onUpdate), opts);
    },

    /**
     * Tween a bare scalar `from → to`, driving `opts.onUpdate(value)` each frame.
     * Guarded no-op → dead handle before start / over the cap.
     *
     * @param from - The starting value.
     * @param to - The target value.
     * @param opts - Tween options; `onUpdate(value)` is required.
     * @returns A {@link TweenHandle} controlling the running tween.
     * @example
     * ```ts
     * api.value(1, 0, { duration: 0.5, onUpdate: v => audio.setVolume("master", v) });
     * ```
     */
    value(from: number, to: number, opts: ValueTweenOptions): TweenHandle {
      const dead = guardCreate("value");
      if (dead) return dead;

      return register(eased => opts.onUpdate(lerp(from, to, eased)), opts);
    },

    /**
     * Stop and drop every active tween (scene teardown). `onComplete` does NOT
     * fire; each `done` settles.
     *
     * @example
     * ```ts
     * api.killAll();
     * ```
     */
    killAll(): void {
      for (const record of ctx.state.tweens.values()) record.settle();
      ctx.state.tweens.clear();
    },

    /**
     * The number of currently-active tweens (diagnostics/tests).
     *
     * @returns The count of active tweens.
     * @example
     * ```ts
     * api.count(); // 0
     * ```
     */
    count(): number {
      return ctx.state.tweens.size;
    },

    easing,

    lerp
  };
};

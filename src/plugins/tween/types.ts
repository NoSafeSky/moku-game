/**
 * @file tween plugin — type definitions.
 *
 * The whole public surface (`app.tween`) plus the internal config/state/record
 * shapes. Nothing here imports Pixi or ECS runtime types — the only cross-module
 * import is the scheduler's `Stage` (for `updateStage`), which the scheduler
 * re-exports from `ecs/types`.
 */
import type { Stage } from "../scheduler/types";

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

/**
 * tween plugin configuration — defaults applied when a tween spec omits a field.
 */
export type Config = {
  /**
   * Duration in seconds used when a tween omits `duration`.
   *
   * @default 0.3
   */
  defaultDuration: number;
  /**
   * Easing curve name used when a tween omits `easing`.
   *
   * @default "easeOutCubic"
   */
  defaultEasing: EasingName;
  /**
   * Scheduler stage the advance system runs in. Validated by `scheduler.addSystem`.
   *
   * @default "update"
   */
  updateStage: Stage;
  /**
   * Safety cap on concurrent active tweens; over-cap `to`/`from`/`value` warn and
   * return a dead handle.
   *
   * @default 2048
   */
  maxActive: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Easing (public surface)
// ─────────────────────────────────────────────────────────────────────────────

/** Names of the built-in easing curves (parity with vfx). */
export type EasingName =
  | "linear"
  | "easeInQuad"
  | "easeOutQuad"
  | "easeInOutQuad"
  | "easeOutCubic"
  | "easeOutBack"
  | "easeOutElastic";

/** A named built-in curve or a custom easing function `f(t): [0,1] → [0,1]`. */
export type Easing = EasingName | ((t: number) => number);

// ─────────────────────────────────────────────────────────────────────────────
// Tween options + handle (public surface)
// ─────────────────────────────────────────────────────────────────────────────

/** Options common to every tween. All optional except where a method requires `onUpdate`. */
export type TweenOptions = {
  /**
   * Duration of one iteration, in seconds.
   *
   * @default config.defaultDuration
   */
  duration?: number;
  /**
   * Easing curve (name or custom fn).
   *
   * @default config.defaultEasing
   */
  easing?: Easing;
  /**
   * Seconds to wait before interpolation begins (start values are still captured
   * at creation time, not deferred).
   *
   * @default 0
   */
  delay?: number;
  /**
   * Extra iterations after the first (`Infinity` allowed).
   *
   * @default 0
   */
  repeat?: number;
  /**
   * Reverse the curve on alternate iterations (ping-pong).
   *
   * @default false
   */
  yoyo?: boolean;
  /** Called each frame after the target/value is updated (eased progress 0..1). */
  onUpdate?: (progress: number) => void;
  /** Called once when the tween completes naturally (never on stop). */
  onComplete?: () => void;
};

/** `value()` requires an `onUpdate` sink (there is no target object to mutate). */
export type ValueTweenOptions = TweenOptions & { onUpdate: (value: number) => void };

/** Opaque control handle for a running tween. */
export type TweenHandle = {
  /** Cancel the tween now; does NOT fire onComplete. Settles `done`. Idempotent. */
  stop(): void;
  /** Freeze advancement (dt no longer consumed) until `resume`. Idempotent. */
  pause(): void;
  /** Resume a paused tween. Idempotent. */
  resume(): void;
  /** True while the tween is still registered (not completed/stopped). */
  readonly active: boolean;
  /** Resolves when the tween settles — completes OR is stopped. Never rejects, never hangs. */
  readonly done: Promise<void>;
};

/** The subset of `T`'s keys whose values are numbers, each optional. */
export type NumericProperties<T> = Partial<
  Pick<T, { [K in keyof T]: T[K] extends number ? K : never }[keyof T]>
>;

// ─────────────────────────────────────────────────────────────────────────────
// Public API surface
// ─────────────────────────────────────────────────────────────────────────────

/** Public API surface (`app.tween`). */
export type Api = {
  /**
   * Tween the numeric props of `target` to the given values, mutating `target` in
   * place each frame. Start values are captured at creation time.
   *
   * @param target - The plain mutable object to animate.
   * @param props - The numeric keys of `target` and their target values.
   * @param opts - Optional duration / easing / delay / repeat / yoyo / callbacks.
   * @returns A {@link TweenHandle} controlling the running tween.
   */
  to<T extends object>(target: T, props: NumericProperties<T>, opts?: TweenOptions): TweenHandle;
  /**
   * Tween the numeric props of `target` FROM the given values to their current
   * values. The "from" values are applied to `target` immediately at creation.
   *
   * @param target - The plain mutable object to animate.
   * @param props - The numeric keys of `target` and their starting ("from") values.
   * @param opts - Optional duration / easing / delay / repeat / yoyo / callbacks.
   * @returns A {@link TweenHandle} controlling the running tween.
   */
  from<T extends object>(target: T, props: NumericProperties<T>, opts?: TweenOptions): TweenHandle;
  /**
   * Tween a bare scalar `from → to`, driving `opts.onUpdate` each frame with the
   * interpolated value (no target object).
   *
   * @param from - The starting value.
   * @param to - The target value.
   * @param opts - Tween options; `onUpdate(value)` is required.
   * @returns A {@link TweenHandle} controlling the running tween.
   */
  value(from: number, to: number, opts: ValueTweenOptions): TweenHandle;
  /**
   * Stop and drop every active tween (scene teardown). onComplete does NOT fire;
   * each `done` settles.
   */
  killAll(): void;
  /**
   * Number of currently-active tweens (diagnostics/tests).
   *
   * @returns The count of active tweens.
   */
  count(): number;
  /** The frozen table of pure easing curves, keyed by name. */
  readonly easing: Readonly<Record<EasingName, (t: number) => number>>;
  /**
   * Linear interpolation `a + (b − a) * t`.
   *
   * @param a - Start value.
   * @param b - End value.
   * @param t - Interpolant, typically 0..1 (not clamped).
   * @returns The interpolated value.
   */
  lerp(a: number, b: number, t: number): number;
};

// ─────────────────────────────────────────────────────────────────────────────
// State (internal)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One in-flight tween. `apply` is a closure over the target/props/onUpdate so the
 * advance system stays target-agnostic.
 */
export type TweenRecord = {
  /** Seconds of `delay` still to elapse before interpolation begins. */
  delayRemaining: number;
  /** Seconds elapsed within the current iteration (0..duration). */
  elapsed: number;
  /** Total duration of one iteration, in seconds (>= a small epsilon so t resolves to 1 on the first tick even for duration 0). */
  duration: number;
  /** Resolved easing function `f(t): [0,1] → roughly [0,1]`. */
  easingFunction: (t: number) => number;
  /** Applies eased progress `eased` (0..1) to the target/onUpdate. Built once at creation. */
  apply: (eased: number) => void;
  /** Remaining extra iterations (repeat count); `Infinity` allowed. 0 = play once. */
  repeatRemaining: number;
  /** Whether to reverse the eased progress on alternate iterations. */
  yoyo: boolean;
  /** Iteration index (0-based) — drives yoyo direction. */
  iteration: number;
  /** When true the advance system skips this record (does not consume dt). */
  paused: boolean;
  /** Called once when the tween completes naturally (not on `stop`). */
  onComplete: (() => void) | undefined;
  /** Settles the handle's `done` Promise (on natural completion OR on `stop`). */
  settle: () => void;
};

/** tween plugin state — the active-tween registry + id source + started guard. */
export type State = {
  /** Active tweens keyed by monotonic id. */
  readonly tweens: Map<number, TweenRecord>;
  /** Monotonic id source for new tweens. */
  nextId: number;
  /** Set true in onStart (advance system registered). Create-before-start is a guarded no-op. */
  started: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared structural dependency types
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

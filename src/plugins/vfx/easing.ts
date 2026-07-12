/**
 * @file vfx plugin — pure easing curves + lerp.
 *
 * Every curve maps `f(0) = 0`, `f(1) = 1` and is finite on `[0, 1]`. These are
 * reused by the vfx systems (particle fade, pop pulse) and re-exported on the
 * public API (`app.vfx.easing`, `app.vfx.lerp`) for consumer juice and a future
 * `tween` plugin. No dependencies — pure math only.
 */
import type { EasingName } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// easeOutBack / easeOutElastic constants
// ─────────────────────────────────────────────────────────────────────────────

/** Overshoot tension for {@link easeOutBack} (the standard 1.70158). */
const BACK_C1 = 1.701_58;
/** Derived overshoot term for {@link easeOutBack}. */
const BACK_C3 = BACK_C1 + 1;
/** Angular frequency for {@link easeOutElastic} (period 0.3 → 2π/0.3). */
const ELASTIC_C4 = (2 * Math.PI) / 3;

/**
 * Linear interpolation `a + (b − a) * t`.
 *
 * @param a - Start value.
 * @param b - End value.
 * @param t - Interpolant, typically 0..1 (not clamped).
 * @returns The interpolated value.
 * @example
 * ```ts
 * lerp(0, 10, 0.5); // 5
 * ```
 */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * The identity curve — `f(t) = t`.
 *
 * @param t - Interpolant, 0..1.
 * @returns `t` unchanged.
 * @example
 * ```ts
 * linear(0.25); // 0.25
 * ```
 */
const linear = (t: number): number => t;

/**
 * Quadratic ease-in — slow start, `f(t) = t²`.
 *
 * @param t - Interpolant, 0..1.
 * @returns The eased value.
 * @example
 * ```ts
 * easeInQuad(0.5); // 0.25
 * ```
 */
const easeInQuad = (t: number): number => t * t;

/**
 * Quadratic ease-out — fast start, `f(t) = 1 − (1 − t)²`.
 *
 * @param t - Interpolant, 0..1.
 * @returns The eased value.
 * @example
 * ```ts
 * easeOutQuad(0.5); // 0.75
 * ```
 */
const easeOutQuad = (t: number): number => 1 - (1 - t) * (1 - t);

/**
 * Quadratic ease-in-out — slow at both ends.
 *
 * @param t - Interpolant, 0..1.
 * @returns The eased value.
 * @example
 * ```ts
 * easeInOutQuad(0.5); // 0.5
 * ```
 */
const easeInOutQuad = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/**
 * Cubic ease-out — `f(t) = 1 − (1 − t)³`.
 *
 * @param t - Interpolant, 0..1.
 * @returns The eased value.
 * @example
 * ```ts
 * easeOutCubic(0.5); // 0.875
 * ```
 */
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

/**
 * Back ease-out — overshoots past 1 then settles (a springy pop).
 *
 * @param t - Interpolant, 0..1.
 * @returns The eased value (may exceed 1 mid-range; `f(1) = 1`).
 * @example
 * ```ts
 * easeOutBack(1); // 1
 * ```
 */
const easeOutBack = (t: number): number => 1 + BACK_C3 * (t - 1) ** 3 + BACK_C1 * (t - 1) ** 2;

/**
 * Elastic ease-out — oscillates then settles at 1 (a wobble).
 *
 * @param t - Interpolant, 0..1.
 * @returns The eased value (`f(0) = 0`, `f(1) = 1`).
 * @example
 * ```ts
 * easeOutElastic(1); // 1
 * ```
 */
const easeOutElastic = (t: number): number => {
  // Endpoints are exact — the general formula is only defined on the open interval.
  if (t === 0) return 0;
  if (t === 1) return 1;
  return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ELASTIC_C4) + 1;
};

/**
 * The frozen table of pure easing curves, keyed by {@link EasingName}. Exposed
 * on the public API as `app.vfx.easing`.
 *
 * @example
 * ```ts
 * const eased = easing.easeOutBack(progress);
 * ```
 */
export const easing: Readonly<Record<EasingName, (t: number) => number>> = Object.freeze({
  linear,
  easeInQuad,
  easeOutQuad,
  easeInOutQuad,
  easeOutCubic,
  easeOutBack,
  easeOutElastic
});

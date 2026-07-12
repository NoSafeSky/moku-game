/**
 * @file tween plugin — the advance system.
 *
 * A single scheduler system that steps every active tween by `dt` each tick. It is
 * pure over `state` + `dt` (the `world` arg is ignored — tweens are not ECS data),
 * so unit tests drive it with a hand-built `State` and explicit `dt` steps: no
 * kernel, no fake timers. Because it is registered on the scheduler and driven by
 * the loop's `scheduler.tick`, a paused loop freezes every tween automatically.
 */
import type { System, World } from "../scheduler/types"; // re-exported from ecs/types
import type { State, TweenRecord } from "./types";

/** Dependencies the advance system reads/mutates — just the tween registry in state. */
export type AdvanceDeps = {
  /** tween plugin state — the active-tween registry the system steps each tick. */
  readonly state: State;
};

/** Disposition of a record after one step: still running, or naturally complete. */
type StepResult = "running" | "complete";

/**
 * Clamp `v` into the inclusive `[lo, hi]` range.
 *
 * @param v - The value to clamp.
 * @param lo - Lower bound.
 * @param hi - Upper bound.
 * @returns `v` constrained to `[lo, hi]`.
 * @example
 * ```ts
 * clamp(1.4, 0, 1); // 1
 * ```
 */
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Advance one record by `dt`: burn down any delay, apply eased progress (yoyo
 * reverses the curve on odd iterations), and at the iteration boundary either
 * repeat (carry overflow + flip yoyo) or report completion. Never touches the
 * registry — the caller handles `onComplete`/`settle`/removal.
 *
 * @param record - The tween record to step (mutated in place).
 * @param dt - Delta-time in seconds for this tick.
 * @returns `"complete"` when the tween finished this step, else `"running"`.
 * @example
 * ```ts
 * if (stepRecord(record, dt) === "complete") record.settle();
 * ```
 */
const stepRecord = (record: TweenRecord, dt: number): StepResult => {
  let step = dt;

  // Delay — burn it down first; carry any overflow past the boundary into elapsed.
  if (record.delayRemaining > 0) {
    record.delayRemaining -= step;
    if (record.delayRemaining > 0) return "running";
    step = -record.delayRemaining;
    record.delayRemaining = 0;
  }

  // Advance within the current iteration, then apply eased progress.
  record.elapsed += step;
  const raw = clamp(record.elapsed / record.duration, 0, 1);
  const reversed = record.yoyo && record.iteration % 2 === 1;
  const t = reversed ? 1 - raw : raw;
  record.apply(record.easingFunction(t));

  // Iteration boundary — repeat (carry overflow, flip yoyo) or complete.
  if (record.elapsed < record.duration) return "running";
  if (record.repeatRemaining > 0) {
    record.repeatRemaining -= 1;
    record.iteration += 1;
    record.elapsed -= record.duration;
    return "running";
  }
  return "complete";
};

/**
 * Create the tween advance system.
 *
 * Steps every non-paused record in insertion order. Completed ids are collected
 * and deleted AFTER the pass, and the pass iterates a snapshot, so a re-entrant
 * `onComplete` that starts a new tween cannot corrupt iteration (the new tween
 * advances next frame) — and one that stops a sibling is honoured via a liveness
 * re-check.
 *
 * @param deps - The tween state to step.
 * @returns A `System` `(world, dt) => void` for the scheduler.
 * @example
 * ```ts
 * scheduler.addSystem("update", createAdvanceSystem({ state }));
 * ```
 */
export const createAdvanceSystem = (deps: AdvanceDeps): System => {
  return (_world: World, dt: number): void => {
    const { tweens } = deps.state;
    if (tweens.size === 0) return;

    // Snapshot the entries: a re-entrant onComplete that creates a new tween must
    // not also advance it this same frame, and one that removes a sibling must be
    // caught by the liveness re-check below.
    const snapshot = [...tweens];
    const completed: number[] = [];

    for (const [id, record] of snapshot) {
      if (!tweens.has(id) || record.paused) continue;
      if (stepRecord(record, dt) === "complete") {
        record.onComplete?.();
        record.settle();
        completed.push(id);
      }
    }

    for (const id of completed) tweens.delete(id);
  };
};

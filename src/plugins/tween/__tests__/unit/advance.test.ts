/**
 * @file tween plugin — advance system unit tests.
 *
 * Drives `createAdvanceSystem` with a hand-built `State` and explicit `dt` steps —
 * no kernel, no fake timers. The system ignores its `world` argument entirely
 * (tweens are not ECS data), so a dummy world is passed.
 */
import { describe, expect, it, vi } from "vitest";
import type { World } from "../../../scheduler/types"; // re-exported from ecs/types
import { createAdvanceSystem } from "../../advance";
import type { State, TweenRecord } from "../../types";

/** The advance system never touches `world`; a dummy satisfies the `System` signature. */
const world = {} as World;

/** Build a TweenRecord with linear defaults, overridable per field. */
const mkRecord = (over: Partial<TweenRecord> = {}): TweenRecord => ({
  delayRemaining: 0,
  elapsed: 0,
  duration: 1,
  easingFunction: (t: number) => t,
  apply: vi.fn(),
  repeatRemaining: 0,
  yoyo: false,
  iteration: 0,
  paused: false,
  onComplete: undefined,
  settle: vi.fn(),
  ...over
});

/** Build a started State seeded with the given records under incremental ids. */
const mkState = (records: TweenRecord[] = []): State => {
  const tweens = new Map<number, TweenRecord>();
  for (const [id, record] of records.entries()) tweens.set(id, record);
  return { tweens, nextId: records.length, started: true };
};

describe("advance — basic interpolation", () => {
  it("advances a linear tween to the endpoint across dt steps, then removes it", () => {
    let v = 0;
    const record = mkRecord({
      duration: 1,
      easingFunction: (t: number) => t,
      apply: (e: number) => {
        v = e * 100;
      }
    });
    const state = mkState([record]);
    const advance = createAdvanceSystem({ state });

    advance(world, 0.5);
    expect(v).toBeCloseTo(50, 6);

    advance(world, 0.5);
    expect(v).toBeCloseTo(100, 6);
    expect(state.tweens.size).toBe(0);
  });

  it("no-ops on an empty registry", () => {
    const state = mkState();
    const advance = createAdvanceSystem({ state });
    expect(() => advance(world, 1)).not.toThrow();
  });

  it("resolves an epsilon-duration tween to the end on the first tick", () => {
    let v = 0;
    const record = mkRecord({
      duration: 1e-6,
      easingFunction: (t: number) => t,
      apply: (e: number) => {
        v = e;
      }
    });
    const state = mkState([record]);
    const advance = createAdvanceSystem({ state });

    advance(world, 1 / 60);
    expect(v).toBe(1);
    expect(state.tweens.size).toBe(0);
  });
});

describe("advance — delay", () => {
  it("defers interpolation until the delay elapses, carrying the overflow", () => {
    const apply = vi.fn();
    const record = mkRecord({ delayRemaining: 0.5, duration: 1, apply });
    const state = mkState([record]);
    const advance = createAdvanceSystem({ state });

    advance(world, 0.3); // still inside the delay
    expect(apply).not.toHaveBeenCalled();
    expect(record.delayRemaining).toBeCloseTo(0.2, 6);

    advance(world, 0.4); // 0.2 finishes the delay, 0.2 spills into elapsed
    expect(apply).toHaveBeenCalledTimes(1);
    expect(record.elapsed).toBeCloseTo(0.2, 6);
  });
});

describe("advance — repeat + yoyo", () => {
  it("repeat replays the iteration and decrements the remaining count", () => {
    const record = mkRecord({ duration: 1, repeatRemaining: 1 });
    const state = mkState([record]);
    const advance = createAdvanceSystem({ state });

    advance(world, 1); // boundary → repeats once
    expect(record.repeatRemaining).toBe(0);
    expect(record.iteration).toBe(1);
    expect(record.elapsed).toBeCloseTo(0, 6);
    expect(state.tweens.size).toBe(1);

    advance(world, 1); // boundary again → completes
    expect(state.tweens.size).toBe(0);
  });

  it("yoyo reverses the eased progress on odd iterations", () => {
    const applied: number[] = [];
    const record = mkRecord({
      duration: 1,
      yoyo: true,
      repeatRemaining: 1,
      easingFunction: (t: number) => t,
      apply: (e: number) => applied.push(e)
    });
    const state = mkState([record]);
    const advance = createAdvanceSystem({ state });

    advance(world, 1); // iteration 0 forward → e = 1
    expect(applied.at(-1)).toBeCloseTo(1, 6);

    advance(world, 0.25); // iteration 1 (odd) reversed → raw 0.25 → t = 0.75
    expect(applied.at(-1)).toBeCloseTo(0.75, 6);
  });
});

describe("advance — completion + lifecycle", () => {
  it("fires onComplete once, settles, and removes the record", () => {
    const onComplete = vi.fn();
    const settle = vi.fn();
    const record = mkRecord({ duration: 1, onComplete, settle });
    const state = mkState([record]);
    const advance = createAdvanceSystem({ state });

    advance(world, 1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(state.tweens.size).toBe(0);

    advance(world, 1); // nothing left — no double fire
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("does not advance a paused record", () => {
    const apply = vi.fn();
    const record = mkRecord({ paused: true, apply });
    const state = mkState([record]);
    const advance = createAdvanceSystem({ state });

    advance(world, 1);
    expect(apply).not.toHaveBeenCalled();
    expect(record.elapsed).toBe(0);
    expect(state.tweens.size).toBe(1);
  });
});

describe("advance — re-entrancy safety", () => {
  it("does not advance a tween added by a re-entrant onComplete until the next frame", () => {
    const newApply = vi.fn();
    const state = mkState();
    const advance = createAdvanceSystem({ state });

    const completing = mkRecord({
      duration: 1,
      onComplete: () => {
        // Simulate api.to() inserting a fresh tween mid-advance.
        state.tweens.set(999, mkRecord({ duration: 1, apply: newApply }));
      }
    });
    state.tweens.set(0, completing);

    advance(world, 1);
    expect(newApply).not.toHaveBeenCalled();
    expect(state.tweens.has(0)).toBe(false);
    expect(state.tweens.has(999)).toBe(true);

    advance(world, 1);
    expect(newApply).toHaveBeenCalledTimes(1);
  });

  it("does not advance a record stopped by an earlier record's onComplete this frame", () => {
    const victimApply = vi.fn();
    const state = mkState();
    const advance = createAdvanceSystem({ state });

    const killer = mkRecord({
      duration: 1,
      onComplete: () => state.tweens.delete(1) // stop the sibling mid-pass
    });
    const victim = mkRecord({ duration: 1, apply: victimApply });
    state.tweens.set(0, killer);
    state.tweens.set(1, victim);

    advance(world, 1);
    expect(victimApply).not.toHaveBeenCalled();
  });
});

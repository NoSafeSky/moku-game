/**
 * @file tween plugin — state factory unit tests.
 *
 * The initial state is an empty registry, a zeroed id source, and `started: false`.
 */
import { describe, expect, it } from "vitest";
import { createState } from "../../state";
import type { Config } from "../../types";

const config: Config = {
  defaultDuration: 0.3,
  defaultEasing: "easeOutCubic",
  updateStage: "update",
  maxActive: 2048
};

describe("createState", () => {
  it("returns an empty registry, nextId 0, and started false", () => {
    const state = createState({ global: {}, config });
    expect(state.tweens).toBeInstanceOf(Map);
    expect(state.tweens.size).toBe(0);
    expect(state.nextId).toBe(0);
    expect(state.started).toBe(false);
  });

  it("returns a fresh Map on each call (no shared registry)", () => {
    const a = createState({ global: {}, config });
    const b = createState({ global: {}, config });
    expect(a.tweens).not.toBe(b.tweens);
  });
});

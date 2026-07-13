/**
 * @file vfx plugin — createState unit tests.
 *
 * The initial state has no tokens (defined in onStart), zeroed trauma +
 * particle count, and an empty views map.
 */
import { describe, expect, it } from "vitest";
import { createState } from "../../state";
import { makeConfig } from "../helpers";

describe("createState", () => {
  it("returns undefined tokens, zeroed counters, and an empty views map", () => {
    const state = createState({ global: {}, config: makeConfig() });

    expect(state.transform).toBeUndefined();
    expect(state.Emitter).toBeUndefined();
    expect(state.Particle).toBeUndefined();
    expect(state.Pop).toBeUndefined();
    expect(state.Flash).toBeUndefined();
    expect(state.FloatingText).toBeUndefined();
    expect(state.trauma).toBe(0);
    expect(state.particleCount).toBe(0);
    expect(state.views.size).toBe(0);
  });
});

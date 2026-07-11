/**
 * @file audio plugin — state unit tests.
 */
import { describe, expect, it } from "vitest";

import { createState } from "../../state";
import type { Config } from "../../types";

const baseConfig: Config = {
  masterVolume: 1,
  sfxVolume: 1,
  musicVolume: 1,
  muted: false,
  manifest: {}
};

const makeState = (overrides?: Partial<Config>) =>
  createState({ global: {}, config: { ...baseConfig, ...overrides } });

describe("audio: createState", () => {
  it("seeds the session mirror from config defaults", () => {
    const state = makeState();

    expect(state.muted).toBe(false);
    expect(state.volumes).toEqual({ master: 1, sfx: 1, music: 1 });
    expect(state.unlocked).toBe(false);
    expect(state.buffers.size).toBe(0);
  });

  it("mirrors config.muted", () => {
    expect(makeState({ muted: true }).muted).toBe(true);
  });

  it("clamps initial volumes to 0..1", () => {
    const state = makeState({ masterVolume: 2, sfxVolume: -1, musicVolume: 0.3 });
    expect(state.volumes).toEqual({ master: 1, sfx: 0, music: 0.3 });
  });

  it("starts with an empty buffer cache", () => {
    expect(makeState().buffers).toBeInstanceOf(Map);
  });
});

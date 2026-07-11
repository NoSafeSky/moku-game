/**
 * @file audio plugin — engine unit tests.
 *
 * Drives createEngine / teardownEngine / clamp01 / resolveAudioContextCtor /
 * decodeFromUrl against the mock WebAudio surface. DOM globals (AudioContext,
 * fetch) are installed as fakes — no jsdom needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clamp01,
  createEngine,
  decodeFromUrl,
  resolveAudioContextCtor,
  teardownEngine
} from "../../engine";
import type { Config } from "../../types";
import {
  fakeBuffer,
  installAudioContext,
  installFetch,
  makeMockAudioContext,
  makeSource
} from "../mock-audio-context";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const defaultConfig: Config = {
  masterVolume: 1,
  sfxVolume: 1,
  musicVolume: 1,
  muted: false,
  manifest: {}
};

const makeLog = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

/** A vendor-prefixed AudioContext constructor stub. */
function webkitCtorStub() {
  return makeMockAudioContext();
}

/** Remove any WebAudio globals a test installed. */
const clearAudioGlobals = (): void => {
  const globals = globalThis as Record<string, unknown>;
  delete globals.AudioContext;
  delete globals.webkitAudioContext;
  delete globals.fetch;
};

beforeEach(() => {
  vi.clearAllMocks();
  clearAudioGlobals();
});

afterEach(() => {
  clearAudioGlobals();
});

// ─────────────────────────────────────────────────────────────────────────────
// clamp01
// ─────────────────────────────────────────────────────────────────────────────

describe("audio: clamp01", () => {
  it("clamps below 0 to 0", () => {
    expect(clamp01(-0.5)).toBe(0);
  });

  it("clamps above 1 to 1", () => {
    expect(clamp01(1.5)).toBe(1);
  });

  it("passes values in range unchanged", () => {
    expect(clamp01(0.42)).toBe(0.42);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveAudioContextCtor
// ─────────────────────────────────────────────────────────────────────────────

describe("audio: resolveAudioContextCtor", () => {
  it("returns undefined when no AudioContext exists", () => {
    expect(resolveAudioContextCtor()).toBeUndefined();
  });

  it("returns the standard AudioContext when present", () => {
    const { uninstall } = installAudioContext();
    expect(resolveAudioContextCtor()).toBeDefined();
    uninstall();
  });

  it("falls back to webkitAudioContext", () => {
    (globalThis as Record<string, unknown>).webkitAudioContext = webkitCtorStub;

    expect(resolveAudioContextCtor()).toBe(webkitCtorStub);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createEngine
// ─────────────────────────────────────────────────────────────────────────────

describe("audio: createEngine", () => {
  it("returns a headless engine and logs when no AudioContext exists", () => {
    const log = makeLog();
    const engine = createEngine(defaultConfig, log);

    expect(engine.headless).toBe(true);
    expect(log.debug).toHaveBeenCalledTimes(1);
  });

  it("builds the master/sfx/music gain graph wired to the destination", () => {
    const { instances, uninstall } = installAudioContext();
    const engine = createEngine(defaultConfig, makeLog());
    uninstall();

    expect(engine.headless).toBe(false);
    if (engine.headless) return;

    const context = instances[0];
    expect(context).toBeDefined();
    if (!context) return;

    // Three channel gains created: master, sfx, music (in that order).
    expect(context.createGain).toHaveBeenCalledTimes(3);
    const [master, sfx, music] = context.gains;

    // Routing: sfx → master, music → master, master → destination.
    expect(sfx?.connect).toHaveBeenCalledWith(master);
    expect(music?.connect).toHaveBeenCalledWith(master);
    expect(master?.connect).toHaveBeenCalledWith(context.destination);
  });

  it("applies config volumes to the channel gains (clamped)", () => {
    const { uninstall } = installAudioContext();
    const engine = createEngine(
      { ...defaultConfig, masterVolume: 0.5, sfxVolume: 2, musicVolume: -1 },
      makeLog()
    );
    uninstall();

    if (engine.headless) throw new Error("expected a live engine");

    expect(engine.master.gain.value).toBe(0.5);
    expect(engine.sfx.gain.value).toBe(1); // clamped from 2
    expect(engine.music.gain.value).toBe(0); // clamped from -1
  });

  it("starts the master bus at 0 when config.muted is true", () => {
    const { uninstall } = installAudioContext();
    const engine = createEngine({ ...defaultConfig, muted: true, masterVolume: 0.8 }, makeLog());
    uninstall();

    if (engine.headless) throw new Error("expected a live engine");
    expect(engine.master.gain.value).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// teardownEngine
// ─────────────────────────────────────────────────────────────────────────────

describe("audio: teardownEngine", () => {
  it("is a no-op for a headless engine", async () => {
    await expect(teardownEngine({ headless: true })).resolves.toBeUndefined();
  });

  it("closes the AudioContext of a live engine", async () => {
    const { uninstall } = installAudioContext();
    const engine = createEngine(defaultConfig, makeLog());
    uninstall();
    if (engine.headless) throw new Error("expected a live engine");

    await teardownEngine(engine);
    expect(engine.context.close).toHaveBeenCalledTimes(1);
  });

  it("stops the active music source and clears it", async () => {
    const { uninstall } = installAudioContext();
    const engine = createEngine(defaultConfig, makeLog());
    uninstall();
    if (engine.headless) throw new Error("expected a live engine");

    const source = makeSource();
    engine.musicSource = source;

    await teardownEngine(engine);
    expect(source.stop).toHaveBeenCalledTimes(1);
    expect(engine.musicSource).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// decodeFromUrl
// ─────────────────────────────────────────────────────────────────────────────

describe("audio: decodeFromUrl", () => {
  it("returns undefined when fetch is unavailable", async () => {
    const context = makeMockAudioContext();
    const result = await decodeFromUrl(context, "sfx/jump.webm");
    expect(result).toBeUndefined();
    expect(context.decodeAudioData).not.toHaveBeenCalled();
  });

  it("fetches then decodes when fetch is available", async () => {
    const { fetchMock, uninstall } = installFetch();
    const context = makeMockAudioContext();

    const result = await decodeFromUrl(context, "sfx/jump.webm");
    uninstall();

    expect(fetchMock).toHaveBeenCalledWith("sfx/jump.webm");
    expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
    expect(result).toBe(fakeBuffer);
  });
});

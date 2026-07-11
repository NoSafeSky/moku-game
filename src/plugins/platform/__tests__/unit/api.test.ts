/**
 * @file platform plugin — API unit tests.
 *
 * Drives createApi against a mock adapter seeded into the platformRegistry and
 * mock loop/audio deps resolved through a fake `require`. Covers the full ad
 * coordination: pause+mute→restore, capture-then-restore (only restore what was
 * changed), the interstitial frequency cap, the re-entrancy guard, reject-safety,
 * `pauseOnAd: false`, and the not-started (no adapter) guards.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApi, type PlatformApiContext } from "../../api";
import { platformRegistry } from "../../lifecycle";
import { createState } from "../../state";
import type { Config } from "../../types";
import {
  type MockAdapter,
  type MockAudio,
  type MockLoop,
  makeLog,
  makeMockAdapter,
  makeMockAudio,
  makeMockLoop,
  makeRequire
} from "../mock-portal";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const defaultConfig: Config = {
  portal: "auto",
  portalEnvVar: "GAME_PORTAL",
  pauseOnAd: true,
  minInterstitialSeconds: 60,
  useNativeStorage: true,
  persistAudioPrefs: true
};

/** Build a platform api ctx with fresh state, a unique WeakMap key, and mock deps. */
const makeCtx = (overrides?: { config?: Partial<Config>; loop?: MockLoop; audio?: MockAudio }) => {
  const config = { ...defaultConfig, ...overrides?.config };
  const state = createState();
  const loop = overrides?.loop ?? makeMockLoop(true);
  const audio = overrides?.audio ?? makeMockAudio(false);
  const emit = vi.fn();
  const global = {};
  const ctx: PlatformApiContext = {
    config,
    state,
    global,
    log: makeLog(),
    require: makeRequire({ loop, audio }),
    emit
  };
  return { ctx, state, loop, audio, emit, global };
};

/** Boot an api with a mock adapter seeded into the registry. */
const boot = (overrides?: {
  config?: Partial<Config>;
  loop?: MockLoop;
  audio?: MockAudio;
  adapter?: MockAdapter;
}) => {
  const base = makeCtx(overrides);
  const adapter = overrides?.adapter ?? makeMockAdapter({ portal: "crazygames" });
  platformRegistry.set(base.global, { adapter, removeListeners: vi.fn() });
  return { ...base, adapter, api: createApi(base.ctx) };
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// commercialBreak — pause + mute + restore
// ─────────────────────────────────────────────────────────────────────────────

describe("platform api: commercialBreak coordination", () => {
  it("pauses loop + mutes audio, shows the ad, then restores both", async () => {
    const { api, loop, audio, adapter, emit } = boot();

    await api.commercialBreak();

    expect(loop.stop).toHaveBeenCalledTimes(1);
    expect(audio.mute).toHaveBeenCalledTimes(1);
    expect(adapter.commercialBreak).toHaveBeenCalledTimes(1);
    expect(loop.start).toHaveBeenCalledTimes(1);
    expect(audio.unmute).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("platform:adStart", { type: "interstitial" });
    expect(emit).toHaveBeenCalledWith("platform:adEnd", { type: "interstitial" });
  });

  it("capture-then-restore: an ad from an already-stopped loop does not restart it", async () => {
    const { api, loop } = boot({ loop: makeMockLoop(false) });

    await api.commercialBreak();

    expect(loop.stop).not.toHaveBeenCalled();
    expect(loop.start).not.toHaveBeenCalled();
  });

  it("capture-then-restore: an ad from an already-muted session does not unmute it", async () => {
    const { api, audio } = boot({ audio: makeMockAudio(true) });

    await api.commercialBreak();

    expect(audio.mute).not.toHaveBeenCalled();
    expect(audio.unmute).not.toHaveBeenCalled();
  });

  it("pauseOnAd:false shows the ad without pausing / muting", async () => {
    const { api, loop, audio, emit } = boot({ config: { pauseOnAd: false } });

    await api.commercialBreak();

    expect(loop.stop).not.toHaveBeenCalled();
    expect(audio.mute).not.toHaveBeenCalled();
    expect(loop.start).not.toHaveBeenCalled();
    expect(audio.unmute).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith("platform:adStart", { type: "interstitial" });
  });

  it("a rejecting ad still restores loop + audio and never rejects to the caller", async () => {
    const { api, loop, audio } = boot({ adapter: makeMockAdapter({ reject: true }) });

    await expect(api.commercialBreak()).resolves.toBeUndefined();
    expect(loop.start).toHaveBeenCalledTimes(1);
    expect(audio.unmute).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Frequency cap
// ─────────────────────────────────────────────────────────────────────────────

describe("platform api: interstitial frequency cap", () => {
  it("suppresses a second interstitial inside the cap window, then allows it after", async () => {
    vi.useFakeTimers();
    const { api, adapter } = boot({ config: { minInterstitialSeconds: 60 } });

    await api.commercialBreak();
    expect(adapter.commercialBreak).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_000); // 30s < 60s → capped
    await api.commercialBreak();
    expect(adapter.commercialBreak).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(31_000); // 61s since the first show → allowed
    await api.commercialBreak();
    expect(adapter.commercialBreak).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// rewardedAd
// ─────────────────────────────────────────────────────────────────────────────

describe("platform api: rewardedAd", () => {
  it("returns the adapter's true + coordinates pause/mute/restore + emits rewarded adEnd", async () => {
    const { api, loop, audio, emit } = boot({ adapter: makeMockAdapter({ rewarded: true }) });

    expect(await api.rewardedAd()).toBe(true);
    expect(loop.stop).toHaveBeenCalledTimes(1);
    expect(audio.mute).toHaveBeenCalledTimes(1);
    expect(loop.start).toHaveBeenCalledTimes(1);
    expect(audio.unmute).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("platform:adStart", { type: "rewarded" });
    expect(emit).toHaveBeenCalledWith("platform:adEnd", { type: "rewarded", rewarded: true });
  });

  it("returns false when the adapter reports the reward was not earned", async () => {
    const { api } = boot({ adapter: makeMockAdapter({ rewarded: false }) });
    expect(await api.rewardedAd()).toBe(false);
  });

  it("a rejecting rewarded ad resolves false and still restores", async () => {
    const { api, loop, audio } = boot({ adapter: makeMockAdapter({ reject: true }) });

    expect(await api.rewardedAd()).toBe(false);
    expect(loop.start).toHaveBeenCalledTimes(1);
    expect(audio.unmute).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Re-entrancy guard
// ─────────────────────────────────────────────────────────────────────────────

describe("platform api: re-entrancy guard", () => {
  it("a second ad while one is in flight is a no-op (commercialBreak resolves, rewardedAd → false)", async () => {
    const { api, state, adapter } = boot();
    state.adPlaying = true; // simulate an ad already in flight

    await expect(api.commercialBreak()).resolves.toBeUndefined();
    expect(adapter.commercialBreak).not.toHaveBeenCalled();

    expect(await api.rewardedAd()).toBe(false);
    expect(adapter.rewardedAd).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Not-started guards + accessors + delegation
// ─────────────────────────────────────────────────────────────────────────────

describe("platform api: guards + accessors", () => {
  it("ads no-op safely when no adapter is registered (before start / after stop)", async () => {
    const { ctx, emit } = makeCtx();
    const api = createApi(ctx);

    await expect(api.commercialBreak()).resolves.toBeUndefined();
    expect(await api.rewardedAd()).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });

  it("lifecycle signals no-op safely when no adapter is registered", () => {
    const { ctx } = makeCtx();
    const api = createApi(ctx);

    expect(() => {
      api.gameplayStart();
      api.gameplayStop();
      api.loadingStart();
      api.loadingFinished();
    }).not.toThrow();
  });

  it("lifecycle signals delegate to the live adapter", () => {
    const { api, adapter } = boot();

    api.gameplayStart();
    api.gameplayStop();
    api.loadingStart();
    api.loadingFinished();

    expect(adapter.gameplayStart).toHaveBeenCalledTimes(1);
    expect(adapter.gameplayStop).toHaveBeenCalledTimes(1);
    expect(adapter.loadingStart).toHaveBeenCalledTimes(1);
    expect(adapter.loadingFinished).toHaveBeenCalledTimes(1);
  });

  it("getPortal reflects state; isAdPlaying reflects the in-flight flag", () => {
    const { api, state } = boot();

    state.portal = "poki";
    expect(api.getPortal()).toBe("poki");

    expect(api.isAdPlaying()).toBe(false);
    state.adPlaying = true;
    expect(api.isAdPlaying()).toBe(true);
  });
});

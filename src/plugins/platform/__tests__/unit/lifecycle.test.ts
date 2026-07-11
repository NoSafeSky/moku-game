/**
 * @file platform plugin — lifecycle unit tests.
 *
 * Drives start/stop against a mock global `window` and mock deps. Covers portal
 * resolution (explicit config, `ctx.env` when "auto", case-insensitive, unknown →
 * none, headless → none), the native-backend injection gate, audio-pref rehydrate,
 * the focus/visibility pause listeners (register + fire + remove), and idempotent stop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { platformRegistry, start, stop } from "../../lifecycle";
import { createState } from "../../state";
import type { Config } from "../../types";
import {
  type MockAudio,
  type MockLoop,
  type MockStorage,
  makeCrazyGamesSdk,
  makeLog,
  makeMockAudio,
  makeMockLoop,
  makeMockStorage,
  makeMockWindow,
  makeRequire
} from "../mock-portal";

const defaultConfig: Config = {
  portal: "auto",
  portalEnvVar: "GAME_PORTAL",
  pauseOnAd: true,
  minInterstitialSeconds: 60,
  useNativeStorage: true,
  persistAudioPrefs: true
};

let uninstall: (() => void) | undefined;

/** Install a mock window on globalThis for the duration of a test. */
const installWindowForTest = (window: object): void => {
  const globals = globalThis as { window?: unknown };
  const previous = globals.window;
  globals.window = window;
  uninstall = () => {
    globals.window = previous;
  };
};

/** Build a start context with mock deps + a controllable env map. */
const makeStartCtx = (overrides?: {
  config?: Partial<Config>;
  env?: Record<string, string>;
  loop?: MockLoop;
  audio?: MockAudio;
  storage?: MockStorage;
}) => {
  const config = { ...defaultConfig, ...overrides?.config };
  const state = createState();
  const loop = overrides?.loop ?? makeMockLoop(true);
  const audio = overrides?.audio ?? makeMockAudio(false);
  const storage = overrides?.storage ?? makeMockStorage();
  const emit = vi.fn();
  const global = {};
  const ctx = {
    config,
    state,
    global,
    log: makeLog(),
    env: { get: (key: string): string | undefined => overrides?.env?.[key] },
    require: makeRequire({ loop, audio, storage }),
    emit
  };
  return { ctx, state, loop, audio, storage, emit, global };
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  uninstall?.();
  uninstall = undefined;
});

// ─────────────────────────────────────────────────────────────────────────────
// Portal resolution
// ─────────────────────────────────────────────────────────────────────────────

describe("platform lifecycle: portal resolution", () => {
  it("uses an explicit config.portal (overriding env)", async () => {
    installWindowForTest(makeMockWindow());
    const { ctx, state, emit } = makeStartCtx({
      config: { portal: "none" },
      env: { GAME_PORTAL: "poki" }
    });

    await start(ctx);

    expect(state.portal).toBe("none");
    expect(emit).toHaveBeenCalledWith("platform:ready", { portal: "none" });
    await stop(ctx);
  });

  it("resolves from ctx.env when portal is 'auto'", async () => {
    installWindowForTest(makeMockWindow());
    const { ctx, state } = makeStartCtx({ env: { GAME_PORTAL: "poki" } });

    await start(ctx);

    expect(state.portal).toBe("poki");
    await stop(ctx);
  });

  it("matches the env value case-insensitively", async () => {
    installWindowForTest(makeMockWindow());
    const { ctx, state } = makeStartCtx({ env: { GAME_PORTAL: "PoKi" } });

    await start(ctx);

    expect(state.portal).toBe("poki");
    await stop(ctx);
  });

  it("falls back to 'none' for an unknown env value", async () => {
    installWindowForTest(makeMockWindow());
    const { ctx, state } = makeStartCtx({ env: { GAME_PORTAL: "xbox" } });

    await start(ctx);

    expect(state.portal).toBe("none");
    await stop(ctx);
  });

  it("headless (no window) resolves 'none' and no-ops without throwing", async () => {
    // No installWindowForTest → globalThis.window is undefined.
    const { ctx, state, emit } = makeStartCtx({ config: { portal: "crazygames" } });

    await expect(start(ctx)).resolves.toBeUndefined();

    expect(state.portal).toBe("none"); // headless guard beats the explicit config
    expect(emit).toHaveBeenCalledWith("platform:ready", { portal: "none" });
    await stop(ctx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Native storage backend injection
// ─────────────────────────────────────────────────────────────────────────────

describe("platform lifecycle: native storage backend", () => {
  it("injects the CrazyGames backend when useNativeStorage + the adapter provides one", async () => {
    installWindowForTest(makeMockWindow({ CrazyGames: { SDK: makeCrazyGamesSdk() } }));
    const { ctx, storage, state } = makeStartCtx({ config: { portal: "crazygames" } });

    await start(ctx);

    expect(state.portal).toBe("crazygames");
    expect(storage.setBackend).toHaveBeenCalledTimes(1);
    expect(storage.setBackend.mock.calls[0]?.[0]?.persistent).toBe(true);
    await stop(ctx);
  });

  it("does not inject a backend for a portal that has none (poki)", async () => {
    installWindowForTest(makeMockWindow({ PokiSDK: {} }));
    const { ctx, storage } = makeStartCtx({ config: { portal: "poki" } });

    await start(ctx);

    expect(storage.setBackend).not.toHaveBeenCalled();
    await stop(ctx);
  });

  it("does not inject a backend when useNativeStorage is false", async () => {
    installWindowForTest(makeMockWindow({ CrazyGames: { SDK: makeCrazyGamesSdk() } }));
    const { ctx, storage } = makeStartCtx({
      config: { portal: "crazygames", useNativeStorage: false }
    });

    await start(ctx);

    expect(storage.setBackend).not.toHaveBeenCalled();
    await stop(ctx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Audio-pref rehydrate
// ─────────────────────────────────────────────────────────────────────────────

describe("platform lifecycle: audio-pref rehydrate", () => {
  it("applies persisted mute/volume to audio at start when persistAudioPrefs", async () => {
    installWindowForTest(makeMockWindow());
    const storage = makeMockStorage(
      new Map<string, unknown>([
        ["audio.muted", true],
        ["audio.volume.music", 0.3]
      ])
    );
    const audio = makeMockAudio();
    const { ctx } = makeStartCtx({ config: { portal: "none" }, audio, storage });

    await start(ctx);

    expect(audio.setMuted).toHaveBeenCalledWith(true);
    expect(audio.setVolume).toHaveBeenCalledWith("music", 0.3);
    await stop(ctx);
  });

  it("skips rehydrate when persistAudioPrefs is false", async () => {
    installWindowForTest(makeMockWindow());
    const audio = makeMockAudio();
    const { ctx } = makeStartCtx({ config: { portal: "none", persistAudioPrefs: false }, audio });

    await start(ctx);

    expect(audio.setMuted).not.toHaveBeenCalled();
    await stop(ctx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Focus / visibility listeners
// ─────────────────────────────────────────────────────────────────────────────

describe("platform lifecycle: focus/visibility listeners", () => {
  it("registers blur/focus/visibilitychange, pauses on blur, restores on focus", async () => {
    const window = makeMockWindow();
    installWindowForTest(window);
    const loop = makeMockLoop(true);
    const audio = makeMockAudio(false);
    const { ctx } = makeStartCtx({ config: { portal: "none" }, loop, audio });

    await start(ctx);

    expect(window.addEventListener).toHaveBeenCalledWith("blur", expect.any(Function));
    expect(window.addEventListener).toHaveBeenCalledWith("focus", expect.any(Function));
    expect(window.addEventListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));

    window.fire("blur");
    expect(loop.stop).toHaveBeenCalledTimes(1);
    expect(audio.mute).toHaveBeenCalledTimes(1);

    window.fire("focus");
    expect(loop.start).toHaveBeenCalledTimes(1);
    expect(audio.unmute).toHaveBeenCalledTimes(1);

    await stop(ctx);
    expect(window.removeEventListener).toHaveBeenCalledTimes(3);
  });

  it("visibilitychange to hidden pauses; to visible restores", async () => {
    const window = makeMockWindow();
    installWindowForTest(window);
    const loop = makeMockLoop(true);
    const { ctx } = makeStartCtx({ config: { portal: "none" }, loop });

    await start(ctx);

    window.document.visibilityState = "hidden";
    window.fire("visibilitychange");
    expect(loop.stop).toHaveBeenCalledTimes(1);

    window.document.visibilityState = "visible";
    window.fire("visibilitychange");
    expect(loop.start).toHaveBeenCalledTimes(1);

    await stop(ctx);
  });

  it("does not register listeners when pauseOnAd is false", async () => {
    const window = makeMockWindow();
    installWindowForTest(window);
    const { ctx } = makeStartCtx({ config: { portal: "none", pauseOnAd: false } });

    await start(ctx);

    expect(window.addEventListener).not.toHaveBeenCalled();
    await stop(ctx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Stop / idempotency
// ─────────────────────────────────────────────────────────────────────────────

describe("platform lifecycle: stop", () => {
  it("destroys the adapter, clears the registry, and is idempotent", async () => {
    installWindowForTest(makeMockWindow());
    const { ctx, global } = makeStartCtx({ config: { portal: "none" } });

    await start(ctx);
    expect(platformRegistry.has(global)).toBe(true);

    await stop(ctx);
    expect(platformRegistry.has(global)).toBe(false);

    // Second stop is a safe no-op.
    await expect(stop(ctx)).resolves.toBeUndefined();
  });
});

/**
 * @file platform plugin — adapter unit tests.
 *
 * Covers selectAdapter's Portal → adapter mapping, the inert noop adapter, the
 * CrazyGames async→sync storage bridge + adapter, and the Poki / Newgrounds
 * adapters — each driven against a mock portal SDK, plus their degraded (no-SDK)
 * and script-injection paths.
 */
import { describe, expect, it, type Mock, vi } from "vitest";

import { createCrazyGamesAdapter, createCrazyGamesBackend } from "../../adapters/crazygames";
import { selectAdapter } from "../../adapters/index";
import { createNewgroundsAdapter } from "../../adapters/newgrounds";
import { createNoopAdapter } from "../../adapters/noop";
import { createPokiAdapter } from "../../adapters/poki";
import type { Portal } from "../../types";
import {
  makeCrazyGamesSdk,
  makeLog,
  makeMockWindow,
  makeNewgroundsSdk,
  makePokiSdk
} from "../mock-portal";

// ─────────────────────────────────────────────────────────────────────────────
// Injectable window (drives the <script>-inject path: append fires "load")
// ─────────────────────────────────────────────────────────────────────────────

type FakeScript = {
  src: string;
  async: boolean;
  addEventListener: Mock;
  listeners: Record<string, () => void>;
};

/** A window with a document.head whose `append` instantly fires the script's "load". */
const makeInjectableWindow = (globals: Record<string, unknown> = {}) => {
  const script: FakeScript = {
    src: "",
    async: false,
    listeners: {},
    addEventListener: vi.fn((type: string, fn: () => void) => {
      script.listeners[type] = fn;
    })
  };
  const window = {
    ...globals,
    document: {
      createElement: vi.fn(() => script),
      head: {
        append: vi.fn(() => {
          script.listeners.load?.(); // simulate an instant load
        })
      }
    }
  };
  return { window, script };
};

// ─────────────────────────────────────────────────────────────────────────────
// selectAdapter
// ─────────────────────────────────────────────────────────────────────────────

describe("platform: selectAdapter", () => {
  it("maps each portal to its adapter", () => {
    expect(selectAdapter("crazygames").portal).toBe("crazygames");
    expect(selectAdapter("poki").portal).toBe("poki");
    expect(selectAdapter("newgrounds").portal).toBe("newgrounds");
    expect(selectAdapter("none").portal).toBe("none");
  });

  it("falls back to the noop adapter for an unknown portal", () => {
    expect(selectAdapter("xbox" as Portal).portal).toBe("none");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// noop adapter
// ─────────────────────────────────────────────────────────────────────────────

describe("platform: noop adapter", () => {
  it("is fully inert; rewardedAd resolves true; no storage backend", async () => {
    const adapter = createNoopAdapter();

    await expect(adapter.init({ log: makeLog(), window: undefined })).resolves.toBeUndefined();
    expect(adapter.storageBackend).toBeUndefined();
    await expect(adapter.commercialBreak()).resolves.toBeUndefined();
    expect(await adapter.rewardedAd()).toBe(true);
    expect(() => {
      adapter.gameplayStart();
      adapter.gameplayStop();
      adapter.loadingStart();
      adapter.loadingFinished();
      adapter.destroy();
    }).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CrazyGames storage bridge
// ─────────────────────────────────────────────────────────────────────────────

describe("platform: CrazyGames storage bridge", () => {
  it("hydrates the snapshot and reads it synchronously", async () => {
    const sdk = makeCrazyGamesSdk({ store: { "game:score": "10" } });
    const bridge = createCrazyGamesBackend(() => sdk.data);

    await bridge.hydrate();

    expect(bridge.backend.persistent).toBe(true);
    expect(bridge.backend.getItem("game:score")).toBe("10");
    expect(bridge.backend.getItem("missing")).toBeNull();
  });

  it("setItem returns true, mirrors to the snapshot, and schedules the async flush", async () => {
    const sdk = makeCrazyGamesSdk();
    const bridge = createCrazyGamesBackend(() => sdk.data);
    await bridge.hydrate();

    expect(bridge.backend.setItem("game:hp", "5")).toBe(true);
    expect(bridge.backend.getItem("game:hp")).toBe("5");
    expect(sdk.data.setItem).toHaveBeenCalledWith("game:hp", "5");
  });

  it("keys filters by prefix; removeItem clears + flushes", async () => {
    const sdk = makeCrazyGamesSdk({ store: { "game:a": "1", "game:b": "2", "other:c": "3" } });
    const bridge = createCrazyGamesBackend(() => sdk.data);
    await bridge.hydrate();

    expect(bridge.backend.keys("game:").toSorted()).toEqual(["game:a", "game:b"]);

    bridge.backend.removeItem("game:a");
    expect(bridge.backend.getItem("game:a")).toBeNull();
    expect(sdk.data.removeItem).toHaveBeenCalledWith("game:a");
  });

  it("no method throws when the data module is unavailable (degraded)", () => {
    const bridge = createCrazyGamesBackend(() => undefined);

    expect(() => {
      bridge.backend.getItem("k");
      bridge.backend.setItem("k", "v");
      bridge.backend.removeItem("k");
      bridge.backend.keys("game:");
    }).not.toThrow();
  });

  it("hydrate is a no-op when the data module is unavailable", async () => {
    const bridge = createCrazyGamesBackend(() => undefined);
    await expect(bridge.hydrate()).resolves.toBeUndefined();
    expect(bridge.backend.getItem("k")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CrazyGames adapter
// ─────────────────────────────────────────────────────────────────────────────

describe("platform: CrazyGames adapter", () => {
  it("init runs the SDK handshake + lifecycle signals delegate", async () => {
    const sdk = makeCrazyGamesSdk();
    const window = makeMockWindow({ CrazyGames: { SDK: sdk } });
    const adapter = createCrazyGamesAdapter();

    await adapter.init({ log: makeLog(), window });

    expect(sdk.init).toHaveBeenCalledTimes(1);
    adapter.gameplayStart();
    adapter.loadingFinished();
    expect(sdk.game.gameplayStart).toHaveBeenCalledTimes(1);
    expect(sdk.game.loadingStop).toHaveBeenCalledTimes(1);
  });

  it("commercialBreak requests a midgame ad; rewardedAd maps a finished ad to true", async () => {
    const sdk = makeCrazyGamesSdk({ adOutcome: "finished" });
    const window = makeMockWindow({ CrazyGames: { SDK: sdk } });
    const adapter = createCrazyGamesAdapter();
    await adapter.init({ log: makeLog(), window });

    await adapter.commercialBreak();
    expect(sdk.ad.requestAd).toHaveBeenCalledWith("midgame", expect.any(Object));
    expect(await adapter.rewardedAd()).toBe(true);
  });

  it("rewardedAd maps an errored ad to false", async () => {
    const sdk = makeCrazyGamesSdk({ adOutcome: "error" });
    const window = makeMockWindow({ CrazyGames: { SDK: sdk } });
    const adapter = createCrazyGamesAdapter();
    await adapter.init({ log: makeLog(), window });

    expect(await adapter.rewardedAd()).toBe(false);
  });

  it("exposes a persistent storage backend", () => {
    expect(createCrazyGamesAdapter().storageBackend?.persistent).toBe(true);
  });

  it("degrades (warns; ads no-op) when the SDK is absent", async () => {
    const log = makeLog();
    const window = makeMockWindow(); // no CrazyGames global, no document.head
    const adapter = createCrazyGamesAdapter();

    await adapter.init({ log, window });

    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(await adapter.rewardedAd()).toBe(false);
    await expect(adapter.commercialBreak()).resolves.toBeUndefined();
  });

  it("injects the SDK script when absent, then degrades if still missing", async () => {
    const log = makeLog();
    const { window, script } = makeInjectableWindow();
    const adapter = createCrazyGamesAdapter();

    await adapter.init({ log, window });

    expect(window.document.createElement).toHaveBeenCalledWith("script");
    expect(script.src).toContain("crazygames");
    expect(window.document.head.append).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledTimes(1); // still missing → degraded
  });

  it("degrades when the SDK init handshake rejects", async () => {
    const log = makeLog();
    const sdk = makeCrazyGamesSdk();
    sdk.init.mockRejectedValueOnce(new Error("handshake failed"));
    const window = makeMockWindow({ CrazyGames: { SDK: sdk } });
    const adapter = createCrazyGamesAdapter();

    await adapter.init({ log, window });

    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Poki adapter
// ─────────────────────────────────────────────────────────────────────────────

describe("platform: Poki adapter", () => {
  it("init handshakes; lifecycle + ads delegate to the SDK", async () => {
    const sdk = makePokiSdk();
    const window = makeMockWindow({ PokiSDK: sdk });
    const adapter = createPokiAdapter();

    await adapter.init({ log: makeLog(), window });

    expect(sdk.init).toHaveBeenCalledTimes(1);
    adapter.loadingStart();
    adapter.loadingFinished();
    adapter.gameplayStart();
    expect(sdk.gameLoadingStart).toHaveBeenCalledTimes(1);
    expect(sdk.gameLoadingFinished).toHaveBeenCalledTimes(1);

    await adapter.commercialBreak();
    expect(sdk.commercialBreak).toHaveBeenCalledTimes(1);
    expect(await adapter.rewardedAd()).toBe(true);
    expect(adapter.storageBackend).toBeUndefined();
  });

  it("swallows a rejecting ad (interstitial resolves, rewarded → false)", async () => {
    const sdk = makePokiSdk({ reject: true });
    const window = makeMockWindow({ PokiSDK: sdk });
    const adapter = createPokiAdapter();
    await adapter.init({ log: makeLog(), window });

    await expect(adapter.commercialBreak()).resolves.toBeUndefined();
    expect(await adapter.rewardedAd()).toBe(false);
  });

  it("degrades (warns; ads no-op) when the SDK is absent", async () => {
    const log = makeLog();
    const adapter = createPokiAdapter();

    await adapter.init({ log, window: makeMockWindow() });

    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(await adapter.rewardedAd()).toBe(false);
    await expect(adapter.commercialBreak()).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Newgrounds adapter
// ─────────────────────────────────────────────────────────────────────────────

describe("platform: Newgrounds adapter", () => {
  it("init opens the session; loadingFinished logs a view; ads trigger", async () => {
    const sdk = makeNewgroundsSdk({ completed: true });
    const window = makeMockWindow({ Newgrounds: sdk });
    const adapter = createNewgroundsAdapter();

    await adapter.init({ log: makeLog(), window });

    expect(sdk.init).toHaveBeenCalledTimes(1);
    adapter.gameplayStart();
    adapter.loadingFinished();
    expect(sdk.logEvent).toHaveBeenCalledWith("gameplay_start");
    expect(sdk.logView).toHaveBeenCalledTimes(1);

    await adapter.commercialBreak();
    expect(sdk.triggerAd).toHaveBeenCalledTimes(1);
    expect(await adapter.rewardedAd()).toBe(true);
    expect(adapter.storageBackend).toBeUndefined();
  });

  it("resolves a no-show when the SDK lacks ad support", async () => {
    const sdk = makeNewgroundsSdk({ withAd: false });
    const window = makeMockWindow({ Newgrounds: sdk });
    const adapter = createNewgroundsAdapter();
    await adapter.init({ log: makeLog(), window });

    await expect(adapter.commercialBreak()).resolves.toBeUndefined();
    expect(await adapter.rewardedAd()).toBe(false);
  });

  it("degrades (warns) when the SDK is absent", async () => {
    const log = makeLog();
    const adapter = createNewgroundsAdapter();

    await adapter.init({ log, window: makeMockWindow() });

    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});

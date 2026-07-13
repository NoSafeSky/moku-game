/**
 * @file platform plugin — integration tests.
 *
 * Boots the framework with the loop stack + audio + storage + platform (portal
 * "none"), a mock AudioContext (so audio is live) and a mock localStorage (so
 * storage persists across app instances). Covers the issue #5 cross-cutting
 * criterion — the full `platform ↔ loop ↔ audio` ad-break coordination
 * (pause+mute during, restore after; adStart→adEnd events) — plus the noop reward
 * branch, the audio-pref persistence round-trip, and the public type contracts.
 */
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { coreConfig } from "../../../../config";
import { audioPlugin } from "../../../audio";
import { installAudioContext, type MockContext } from "../../../audio/__tests__/mock-audio-context";
import { ecsPlugin } from "../../../ecs";
import { loopPlugin } from "../../../loop";
import { rendererPlugin } from "../../../renderer";
import { schedulerPlugin } from "../../../scheduler";
import { storagePlugin } from "../../../storage";
import * as adapters from "../../adapters";
import { platformPlugin } from "../../index";
import type { AdType, Portal } from "../../types";
import { makeMockAdapter } from "../mock-portal";

// ─────────────────────────────────────────────────────────────────────────────
// Mock localStorage (so storage persists across app instances)
// ─────────────────────────────────────────────────────────────────────────────

let audio: { instances: MockContext[]; uninstall: () => void };
let storageUninstall: () => void;

const installLocalStorage = (): (() => void) => {
  const map = new Map<string, string>();
  const localStorage = {
    getItem: (key: string): string | null => map.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      map.set(key, value);
    },
    removeItem: (key: string): void => {
      map.delete(key);
    },
    key: (index: number): string | null => [...map.keys()][index] ?? null,
    get length(): number {
      return map.size;
    }
  };
  const globals = globalThis as { localStorage?: unknown };
  const previous = globals.localStorage;
  globals.localStorage = localStorage;
  return () => {
    globals.localStorage = previous;
  };
};

/** Flush the microtask/timer queue so fire-and-forget hooks have run. */
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  audio = installAudioContext();
  storageUninstall = installLocalStorage();
});

afterEach(() => {
  storageUninstall();
  audio.uninstall();
});

// ─────────────────────────────────────────────────────────────────────────────
// App factory
// ─────────────────────────────────────────────────────────────────────────────

const createGameApp = () => {
  const { createApp, createPlugin } = coreConfig.createCore(coreConfig, {
    plugins: [
      ecsPlugin,
      schedulerPlugin,
      rendererPlugin,
      loopPlugin,
      audioPlugin,
      storagePlugin,
      platformPlugin
    ]
  });
  return { createApp, createPlugin };
};

const bootGameApp = async () => {
  const { createApp } = createGameApp();
  const app = createApp({
    pluginConfigs: {
      loop: { autoStart: false },
      platform: { portal: "none", minInterstitialSeconds: 0 }
    }
  });
  await app.start();
  await app.audio.unlock();
  return app;
};

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

describe("platform plugin integration", () => {
  describe("lifecycle", () => {
    it("starts and stops without error", async () => {
      const app = await bootGameApp();
      await expect(app.stop()).resolves.toBeUndefined();
    });

    it("exposes app.platform, resolving portal 'none' locally", async () => {
      const app = await bootGameApp();
      expect(app.platform).toBeDefined();
      expect(app.platform.getPortal()).toBe("none");
      await app.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Ad-break coordination — the issue #5 cross-cutting criterion
  // ──────────────────────────────────────────────────────────────────────────

  describe("ad-break coordination (platform ↔ loop ↔ audio)", () => {
    it("commercialBreak pauses loop + mutes audio during the ad, restores both after", async () => {
      const app = await bootGameApp();
      app.loop.start();
      app.audio.unmute();
      expect(app.loop.isRunning()).toBe(true);
      expect(app.audio.isMuted()).toBe(false);

      // Spy through the real implementations to prove pause+mute precede restore.
      const stopSpy = vi.spyOn(app.loop, "stop");
      const muteSpy = vi.spyOn(app.audio, "mute");
      const startSpy = vi.spyOn(app.loop, "start");
      const unmuteSpy = vi.spyOn(app.audio, "unmute");

      await app.platform.commercialBreak();

      // Paused + muted, then restored — the pause/mute call precedes its restore.
      expect(stopSpy).toHaveBeenCalledTimes(1);
      expect(muteSpy).toHaveBeenCalledTimes(1);
      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(unmuteSpy).toHaveBeenCalledTimes(1);
      expect(stopSpy.mock.invocationCallOrder[0]).toBeLessThan(
        startSpy.mock.invocationCallOrder[0] ?? 0
      );
      expect(muteSpy.mock.invocationCallOrder[0]).toBeLessThan(
        unmuteSpy.mock.invocationCallOrder[0] ?? 0
      );

      // Restored after the ad.
      expect(app.loop.isRunning()).toBe(true);
      expect(app.audio.isMuted()).toBe(false);
      await app.stop();
    });

    it("a hooked consumer receives platform:adStart then platform:adEnd", async () => {
      const received: AdType[] = [];
      const { createApp, createPlugin } = createGameApp();

      const listenerPlugin = createPlugin("ad-listener", {
        depends: [platformPlugin],
        hooks: _ctx => ({
          "platform:adStart": () => {
            received.push("interstitial");
          },
          "platform:adEnd": () => {
            received.push("rewarded");
          }
        })
      });

      const app = createApp({
        plugins: [listenerPlugin],
        pluginConfigs: {
          loop: { autoStart: false },
          platform: { portal: "none", minInterstitialSeconds: 0 }
        }
      });
      await app.start();

      await app.platform.commercialBreak();
      await settle();

      // adStart pushed before adEnd.
      expect(received).toEqual(["interstitial", "rewarded"]);
      await app.stop();
    });

    it("rewardedAd resolves true on the noop adapter (dev reward branch)", async () => {
      const app = await bootGameApp();
      expect(await app.platform.rewardedAd()).toBe(true);
      await app.stop();
    });

    it("commercialBreak still resumes loop + unmutes audio when the underlying ad REJECTS", async () => {
      // Swap only the leaf adapter for a rejecting one — the real loop/audio/platform
      // wiring stays intact, exactly the failure the `finally` block must survive.
      const rejecting = makeMockAdapter({ reject: true });
      const selectSpy = vi.spyOn(adapters, "selectAdapter").mockReturnValue(rejecting);
      try {
        const app = await bootGameApp();
        app.loop.start();
        app.audio.unmute();

        const startSpy = vi.spyOn(app.loop, "start");
        const unmuteSpy = vi.spyOn(app.audio, "unmute");

        // The adapter's ad promise rejects, yet the break settles cleanly to the caller.
        await expect(app.platform.commercialBreak()).resolves.toBeUndefined();
        expect(rejecting.commercialBreak).toHaveBeenCalledTimes(1);

        // …and the `finally` block resumed the loop + unmuted audio.
        expect(startSpy).toHaveBeenCalledTimes(1);
        expect(unmuteSpy).toHaveBeenCalledTimes(1);
        expect(app.loop.isRunning()).toBe(true);
        expect(app.audio.isMuted()).toBe(false);
        await app.stop();
      } finally {
        selectSpy.mockRestore();
      }
    });

    it("rewardedAd resolves false + still restores loop + audio when the ad REJECTS", async () => {
      const rejecting = makeMockAdapter({ reject: true });
      const selectSpy = vi.spyOn(adapters, "selectAdapter").mockReturnValue(rejecting);
      try {
        const app = await bootGameApp();
        app.loop.start();
        app.audio.unmute();

        const startSpy = vi.spyOn(app.loop, "start");
        const unmuteSpy = vi.spyOn(app.audio, "unmute");

        // A rejected rewarded ad grants no reward, but must still restore the game.
        await expect(app.platform.rewardedAd()).resolves.toBe(false);
        expect(rejecting.rewardedAd).toHaveBeenCalledTimes(1);
        expect(startSpy).toHaveBeenCalledTimes(1);
        expect(unmuteSpy).toHaveBeenCalledTimes(1);
        expect(app.loop.isRunning()).toBe(true);
        expect(app.audio.isMuted()).toBe(false);
        await app.stop();
      } finally {
        selectSpy.mockRestore();
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Audio-pref persistence round-trip
  // ──────────────────────────────────────────────────────────────────────────

  describe("audio-pref persistence", () => {
    it("a mute change persists through storage and rehydrates in a fresh app", async () => {
      // App 1: mute, which writes through storage via the platform hook.
      const app1 = await bootGameApp();
      app1.audio.setMuted(true);
      await settle(); // let the fire-and-forget hook write to storage
      expect(app1.audio.isMuted()).toBe(true);
      await app1.stop();

      // App 2: a fresh app rehydrates the persisted mute at start.
      const app2 = await bootGameApp();
      expect(app2.audio.isMuted()).toBe(true);
      await app2.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Types
  // ──────────────────────────────────────────────────────────────────────────

  describe("types", () => {
    it("commercialBreak is Promise<void> and rewardedAd is Promise<boolean>", async () => {
      const app = await bootGameApp();
      expectTypeOf(app.platform.commercialBreak()).toEqualTypeOf<Promise<void>>();
      expectTypeOf(app.platform.rewardedAd()).toEqualTypeOf<Promise<boolean>>();
      expectTypeOf(app.platform.getPortal()).toEqualTypeOf<Portal>();
      await app.stop();
    });

    it("platform:adEnd accepts a rewarded payload; rejects a wrong one", () => {
      const { createPlugin } = createGameApp();

      const plugin = createPlugin("emit-check", {
        depends: [platformPlugin],
        api: ctx => ({
          ok: () => {
            ctx.emit("platform:adEnd", { type: "rewarded", rewarded: true });
          },
          bad: () => {
            // @ts-expect-error -- "banner" is not a valid AdType
            ctx.emit("platform:adEnd", { type: "banner" });
          }
        })
      });

      expect(plugin.name).toBe("emit-check");
    });

    it("rejects an invalid portal in pluginConfigs", () => {
      const { createApp } = createGameApp();

      const app = createApp({
        pluginConfigs: {
          platform: {
            // @ts-expect-error -- "xbox" is not a valid Portal
            portal: "xbox"
          }
        }
      });

      expect(app).toBeDefined();
    });
  });
});

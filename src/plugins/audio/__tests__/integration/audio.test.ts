/**
 * @file audio plugin — integration tests.
 *
 * Boots the framework with audioPlugin (and, for the ad-break rehearsal, the
 * loop stack) and a mock AudioContext + fetch installed on globalThis. Covers
 * lifecycle, event propagation to a consumer hook, load/play end-to-end, the
 * platform ad-break shape (mute + pause), headless no-op, and event types.
 */
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { coreConfig } from "../../../../config";
import { ecsPlugin } from "../../../ecs";
import { loopPlugin } from "../../../loop";
import { rendererPlugin } from "../../../renderer";
import { schedulerPlugin } from "../../../scheduler";
import { audioPlugin } from "../../index";
import type { Channel } from "../../types";
import { installAudioContext, installFetch, type MockContext } from "../mock-audio-context";

// ─────────────────────────────────────────────────────────────────────────────
// Global install (mock AudioContext + fetch)
// ─────────────────────────────────────────────────────────────────────────────

let audio: { instances: MockContext[]; uninstall: () => void };
let fetchHandle: { fetchMock: ReturnType<typeof vi.fn>; uninstall: () => void };

beforeEach(() => {
  vi.clearAllMocks();
  audio = installAudioContext();
  fetchHandle = installFetch();
});

afterEach(() => {
  fetchHandle.uninstall();
  audio.uninstall();
});

// ─────────────────────────────────────────────────────────────────────────────
// App factories
// ─────────────────────────────────────────────────────────────────────────────

/** Just the audio plugin (it has no game-plugin dependencies). */
const createAudioApp = () => {
  const { createApp } = coreConfig.createCore(coreConfig, { plugins: [audioPlugin] });
  return createApp();
};

/** The loop stack + audio, for the ad-break rehearsal (renderer auto-headless in node). */
const createGameApp = () => {
  const { createApp } = coreConfig.createCore(coreConfig, {
    plugins: [ecsPlugin, schedulerPlugin, rendererPlugin, loopPlugin, audioPlugin]
  });
  return createApp({ pluginConfigs: { loop: { autoStart: false } } });
};

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

describe("audio plugin integration", () => {
  describe("lifecycle", () => {
    it("starts and stops without error", async () => {
      const app = createAudioApp();
      await expect(app.start()).resolves.toBeUndefined();
      await expect(app.stop()).resolves.toBeUndefined();
    });

    it("exposes app.audio after start", async () => {
      const app = createAudioApp();
      await app.start();
      expect(app.audio).toBeDefined();
      await app.stop();
    });

    it("closes the AudioContext on stop", async () => {
      const app = createAudioApp();
      await app.start();
      await app.stop();
      expect(audio.instances[0]?.close).toHaveBeenCalledTimes(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Runtime behaviour end-to-end
  // ──────────────────────────────────────────────────────────────────────────

  describe("runtime", () => {
    it("unlock resumes the context", async () => {
      const app = createAudioApp();
      await app.start();

      await app.audio.unlock();
      expect(audio.instances[0]?.resume).toHaveBeenCalledTimes(1);

      await app.stop();
    });

    it("load then play produces a source on the sfx channel", async () => {
      const app = createAudioApp();
      await app.start();
      await app.audio.unlock();

      await app.audio.load("jump", "sfx/jump.webm");
      app.audio.play("jump");

      const context = audio.instances[0];
      expect(fetchHandle.fetchMock).toHaveBeenCalledWith("sfx/jump.webm");
      expect(context?.sources).toHaveLength(1);
      expect(context?.sources[0]?.start).toHaveBeenCalledTimes(1);

      await app.stop();
    });

    it("mute zeroes the master gain, unmute restores it", async () => {
      const app = createAudioApp();
      await app.start();

      const master = audio.instances[0]?.gains[0];
      app.audio.mute();
      expect(master?.gain.value).toBe(0);

      app.audio.unmute();
      expect(master?.gain.value).toBe(1);

      await app.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Events → consumer hook
  // ──────────────────────────────────────────────────────────────────────────

  describe("events", () => {
    it("audio:muteChanged is received by a consumer plugin hook", async () => {
      const received: Array<{ muted: boolean }> = [];

      const { createApp, createPlugin } = coreConfig.createCore(coreConfig, {
        plugins: [audioPlugin]
      });

      const listenerPlugin = createPlugin("audio-listener", {
        depends: [audioPlugin],
        hooks: _ctx => ({
          "audio:muteChanged": payload => {
            received.push(payload);
          }
        })
      });

      const app = createApp({ plugins: [listenerPlugin] });
      await app.start();

      app.audio.mute();

      expect(received).toEqual([{ muted: true }]);

      await app.stop();
    });

    it("audio:volumeChanged is received by a consumer plugin hook", async () => {
      const received: Array<{ channel: Channel; value: number }> = [];

      const { createApp, createPlugin } = coreConfig.createCore(coreConfig, {
        plugins: [audioPlugin]
      });

      const listenerPlugin = createPlugin("volume-listener", {
        depends: [audioPlugin],
        hooks: _ctx => ({
          "audio:volumeChanged": payload => {
            received.push(payload);
          }
        })
      });

      const app = createApp({ plugins: [listenerPlugin] });
      await app.start();

      app.audio.setVolume("music", 0.5);

      expect(received).toEqual([{ channel: "music", value: 0.5 }]);

      await app.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Platform ad-break rehearsal (mute + pause is a single call each)
  // ──────────────────────────────────────────────────────────────────────────

  describe("ad-break coordination (platform shape)", () => {
    it("pause + mute → resume + unmute round-trips", async () => {
      const app = createGameApp();
      await app.start();
      await app.audio.unlock();

      app.loop.start();
      expect(app.loop.isRunning()).toBe(true);

      // Ad break: a single mute() call ducks the whole mix; loop pauses.
      app.loop.stop();
      app.audio.mute();
      expect(app.loop.isRunning()).toBe(false);
      expect(app.audio.isMuted()).toBe(true);

      // Ad ends: resume + a single unmute() call restores the mix.
      app.loop.start();
      app.audio.unmute();
      expect(app.loop.isRunning()).toBe(true);
      expect(app.audio.isMuted()).toBe(false);

      await app.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Headless (no AudioContext) — every method no-ops
  // ──────────────────────────────────────────────────────────────────────────

  describe("headless", () => {
    it("every method returns without throwing and mute does not emit", async () => {
      audio.uninstall(); // remove the mock AudioContext → headless

      const received: Array<{ muted: boolean }> = [];
      const { createApp, createPlugin } = coreConfig.createCore(coreConfig, {
        plugins: [audioPlugin]
      });
      const listenerPlugin = createPlugin("headless-listener", {
        depends: [audioPlugin],
        hooks: _ctx => ({
          "audio:muteChanged": payload => {
            received.push(payload);
          }
        })
      });

      const app = createApp({ plugins: [listenerPlugin] });
      await app.start();

      await expect(app.audio.unlock()).resolves.toBeUndefined();
      await expect(app.audio.load("x", "u")).resolves.toBeUndefined();
      expect(() => app.audio.play("x")).not.toThrow();
      expect(() => app.audio.playMusic("x")).not.toThrow();
      expect(() => app.audio.stopMusic()).not.toThrow();
      expect(() => app.audio.mute()).not.toThrow();
      expect(() => app.audio.setVolume("sfx", 0.5)).not.toThrow();

      // Getters still work; mute did not emit (fully headless no-op).
      expect(app.audio.isMuted()).toBe(false);
      expect(app.audio.getVolume("sfx")).toBe(1);
      expect(received).toHaveLength(0);

      await app.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Types
  // ──────────────────────────────────────────────────────────────────────────

  describe("types", () => {
    it("app.audio.getVolume accepts only a Channel", async () => {
      const app = createAudioApp();
      await app.start();

      expectTypeOf(app.audio.getVolume).toEqualTypeOf<(channel: Channel) => number>();

      await app.stop();
    });

    it("setVolume / getVolume accept only a Channel argument (type-level)", async () => {
      const app = createAudioApp();
      await app.start();

      expectTypeOf(app.audio.setVolume).parameter(0).toEqualTypeOf<Channel>();
      expectTypeOf(app.audio.getVolume).parameter(0).toEqualTypeOf<Channel>();

      await app.stop();
    });

    it("audio:muteChanged payload is typed in a consumer hook", () => {
      const { createPlugin } = coreConfig.createCore(coreConfig, { plugins: [audioPlugin] });

      createPlugin("type-check", {
        depends: [audioPlugin],
        hooks: _ctx => ({
          "audio:muteChanged": payload => {
            expectTypeOf(payload).toEqualTypeOf<{ muted: boolean }>();
          }
        })
      });
    });

    it("rejects a wrong audio:muteChanged payload", () => {
      const { createPlugin } = coreConfig.createCore(coreConfig, { plugins: [audioPlugin] });

      const plugin = createPlugin("wrong-payload", {
        depends: [audioPlugin],
        api: ctx => ({
          test: () => {
            // @ts-expect-error -- "mute" is not a valid key (should be "muted")
            ctx.emit("audio:muteChanged", { mute: true });
          }
        })
      });

      expect(plugin.name).toBe("wrong-payload");
    });

    it("rejects an invalid Channel in audio:volumeChanged", () => {
      const { createPlugin } = coreConfig.createCore(coreConfig, { plugins: [audioPlugin] });

      const plugin = createPlugin("wrong-channel", {
        depends: [audioPlugin],
        api: ctx => ({
          test: () => {
            // @ts-expect-error -- "bad" is not a valid Channel
            ctx.emit("audio:volumeChanged", { channel: "bad", value: 1 });
          }
        })
      });

      expect(plugin.name).toBe("wrong-channel");
    });
  });
});

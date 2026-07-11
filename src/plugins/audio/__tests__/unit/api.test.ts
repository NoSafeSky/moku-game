/**
 * @file audio plugin — API unit tests.
 *
 * Drives createApi against a seeded engine (live or headless) in the module
 * WeakMap. Covers the mute bus, per-channel volume, load/play/music, unlock,
 * headless no-op, WeakMap-miss guards, and event emission.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type AudioApiContext, createApi } from "../../api";
import { audioRegistry } from "../../engine";
import { createState } from "../../state";
import type { Config } from "../../types";
import { fakeBuffer, installFetch, makeLiveEngine } from "../mock-audio-context";

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

/** Build a ctx with fresh state + a unique WeakMap key. */
const makeCtx = (
  configOverrides?: Partial<Config>
): { ctx: AudioApiContext; emit: ReturnType<typeof vi.fn>; log: ReturnType<typeof makeLog> } => {
  const config = { ...defaultConfig, ...configOverrides };
  const state = createState({ global: {}, config });
  const emit = vi.fn();
  const log = makeLog();
  const ctx: AudioApiContext = { config, state, global: {}, log, emit };
  return { ctx, emit, log };
};

/** Boot a live engine seeded into the registry for the given ctx. */
const bootLive = (configOverrides?: Partial<Config>) => {
  const { ctx, emit, log } = makeCtx(configOverrides);
  const nodes = makeLiveEngine();
  audioRegistry.set(ctx.global, nodes.engine);
  return { ctx, emit, log, api: createApi(ctx), ...nodes };
};

/** Boot a headless engine seeded into the registry for the given ctx. */
const bootHeadless = (configOverrides?: Partial<Config>) => {
  const { ctx, emit, log } = makeCtx(configOverrides);
  audioRegistry.set(ctx.global, { headless: true });
  return { ctx, emit, log, api: createApi(ctx) };
};

/** Boot live + unlocked + one loaded buffer named "jump". */
const bootPlayable = () => {
  const booted = bootLive();
  booted.ctx.state.unlocked = true;
  booted.ctx.state.buffers.set("jump", fakeBuffer);
  return booted;
};

/** Boot live + unlocked + one loaded buffer named "theme". */
const bootMusic = () => {
  const booted = bootLive();
  booted.ctx.state.unlocked = true;
  booted.ctx.state.buffers.set("theme", fakeBuffer);
  return booted;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  const globals = globalThis as Record<string, unknown>;
  delete globals.fetch;
});

// ─────────────────────────────────────────────────────────────────────────────
// unlock
// ─────────────────────────────────────────────────────────────────────────────

describe("audio: unlock", () => {
  it("resumes the context and sets state.unlocked", async () => {
    const { api, ctx, context } = bootLive();

    await api.unlock();

    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(ctx.state.unlocked).toBe(true);
  });

  it("is idempotent (safe to call every gesture)", async () => {
    const { api, ctx, context } = bootLive();

    await api.unlock();
    await api.unlock();

    expect(context.resume).toHaveBeenCalledTimes(2);
    expect(ctx.state.unlocked).toBe(true);
  });

  it("no-ops without throwing when headless", async () => {
    const { api, ctx } = bootHeadless();
    await expect(api.unlock()).resolves.toBeUndefined();
    expect(ctx.state.unlocked).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// load
// ─────────────────────────────────────────────────────────────────────────────

describe("audio: load", () => {
  it("fetches + decodes + caches a buffer once", async () => {
    const { fetchMock, uninstall } = installFetch();
    const { api, ctx, context } = bootLive();

    await api.load("jump", "sfx/jump.webm");

    expect(fetchMock).toHaveBeenCalledWith("sfx/jump.webm");
    expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
    expect(ctx.state.buffers.get("jump")).toBe(fakeBuffer);
    uninstall();
  });

  it("resolves the url from the manifest when omitted", async () => {
    const { fetchMock, uninstall } = installFetch();
    const { api } = bootLive({ manifest: { jump: "from/manifest.webm" } });

    await api.load("jump");

    expect(fetchMock).toHaveBeenCalledWith("from/manifest.webm");
    uninstall();
  });

  it("is a no-op for a cached name (one decode)", async () => {
    const { uninstall } = installFetch();
    const { api, context } = bootLive();

    await api.load("jump", "sfx/jump.webm");
    await api.load("jump", "sfx/jump.webm");

    expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
    uninstall();
  });

  it("debug-logs and skips when no url and not in manifest", async () => {
    const { api, log, ctx } = bootLive();

    await api.load("missing");

    expect(log.debug).toHaveBeenCalledTimes(1);
    expect(ctx.state.buffers.has("missing")).toBe(false);
  });

  it("no-ops without throwing when headless", async () => {
    const { api, ctx } = bootHeadless();
    await expect(api.load("jump", "u.webm")).resolves.toBeUndefined();
    expect(ctx.state.buffers.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// play
// ─────────────────────────────────────────────────────────────────────────────

describe("audio: play", () => {
  it("creates a source on the sfx channel when unlocked + loaded", () => {
    const { api, context, sfx } = bootPlayable();

    api.play("jump");

    expect(context.createBufferSource).toHaveBeenCalledTimes(1);
    const source = context.sources[0];
    expect(source?.buffer).toBe(fakeBuffer);
    expect(source?.connect).toHaveBeenCalledWith(sfx);
    expect(source?.start).toHaveBeenCalledTimes(1);
  });

  it("applies the playback rate option", () => {
    const { api, context } = bootPlayable();

    api.play("jump", { rate: 1.5 });

    expect(context.sources[0]?.playbackRate.value).toBe(1.5);
  });

  it("routes through a per-shot gain when volume is given", () => {
    const { api, context, sfx } = bootPlayable();

    api.play("jump", { volume: 0.5 });

    // One per-shot gain created, connected into sfx; source connected into it.
    expect(context.createGain).toHaveBeenCalledTimes(1);
    const shotGain = context.gains[0];
    expect(shotGain?.gain.value).toBe(0.5);
    expect(shotGain?.connect).toHaveBeenCalledWith(sfx);
    expect(context.sources[0]?.connect).toHaveBeenCalledWith(shotGain);
  });

  it("debug no-op when not unlocked", () => {
    const booted = bootLive();
    booted.ctx.state.buffers.set("jump", fakeBuffer);

    booted.api.play("jump");

    expect(booted.context.createBufferSource).not.toHaveBeenCalled();
    expect(booted.log.debug).toHaveBeenCalledTimes(1);
  });

  it("debug no-op when not loaded", () => {
    const booted = bootLive();
    booted.ctx.state.unlocked = true;

    booted.api.play("jump");

    expect(booted.context.createBufferSource).not.toHaveBeenCalled();
    expect(booted.log.debug).toHaveBeenCalledTimes(1);
  });

  it("debug no-op when headless", () => {
    const { api, log } = bootHeadless();
    expect(() => api.play("jump")).not.toThrow();
    expect(log.debug).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// playMusic / stopMusic
// ─────────────────────────────────────────────────────────────────────────────

describe("audio: playMusic / stopMusic", () => {
  it("starts a looping source on the music channel", () => {
    const { api, context, music, engine } = bootMusic();

    api.playMusic("theme");

    const source = context.sources[0];
    expect(source?.loop).toBe(true);
    expect(source?.connect).toHaveBeenCalledWith(music);
    expect(source?.start).toHaveBeenCalledTimes(1);
    expect(engine.musicSource).toBe(source);
  });

  it("honors loop:false", () => {
    const { api, context } = bootMusic();
    api.playMusic("theme", { loop: false });
    expect(context.sources[0]?.loop).toBe(false);
  });

  it("ramps the music gain from 0 on fadeIn", () => {
    const { api, music } = bootMusic();

    api.playMusic("theme", { fadeIn: 0.5 });

    expect(music.gain.setValueAtTime).toHaveBeenCalledWith(0, 0);
    expect(music.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 0.5);
  });

  it("sets the music gain immediately without fadeIn", () => {
    const { api, music } = bootMusic();

    api.playMusic("theme");

    expect(music.gain.setValueAtTime).toHaveBeenCalledWith(1, 0);
    expect(music.gain.linearRampToValueAtTime).not.toHaveBeenCalled();
  });

  it("stops the previous track before starting a new one", () => {
    const { api, context } = bootMusic();

    api.playMusic("theme");
    api.playMusic("theme");

    // First source stopped when the second started.
    expect(context.sources[0]?.stop).toHaveBeenCalledTimes(1);
    expect(context.sources).toHaveLength(2);
  });

  it("stopMusic stops the active source immediately", () => {
    const { api, context, engine } = bootMusic();

    api.playMusic("theme");
    api.stopMusic();

    expect(context.sources[0]?.stop).toHaveBeenCalledTimes(1);
    expect(engine.musicSource).toBeUndefined();
  });

  it("stopMusic ramps out then schedules the stop on fadeOut", () => {
    const { api, context, music } = bootMusic();

    api.playMusic("theme");
    api.stopMusic({ fadeOut: 1 });

    expect(music.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 1);
    expect(context.sources[0]?.stop).toHaveBeenCalledWith(1);
  });

  it("stopMusic is a no-op when nothing is playing", () => {
    const { api } = bootMusic();
    expect(() => api.stopMusic()).not.toThrow();
  });

  it("playMusic debug no-op when not unlocked", () => {
    const booted = bootLive();
    booted.ctx.state.buffers.set("theme", fakeBuffer);
    booted.api.playMusic("theme");
    expect(booted.context.createBufferSource).not.toHaveBeenCalled();
  });

  it("playMusic debug no-op when not loaded", () => {
    const booted = bootLive();
    booted.ctx.state.unlocked = true;

    booted.api.playMusic("theme");

    expect(booted.context.createBufferSource).not.toHaveBeenCalled();
    expect(booted.log.debug).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mute / unmute / setMuted / isMuted
// ─────────────────────────────────────────────────────────────────────────────

describe("audio: mute bus", () => {
  it("mute() zeroes the master gain and emits audio:muteChanged", () => {
    const { api, emit, master, ctx } = bootLive();

    api.mute();

    expect(master.gain.value).toBe(0);
    expect(ctx.state.muted).toBe(true);
    expect(emit).toHaveBeenCalledWith("audio:muteChanged", { muted: true });
  });

  it("unmute() restores the master gain to masterVolume and emits", () => {
    const { api, emit, master, ctx } = bootLive({ masterVolume: 0.7 });
    ctx.state.muted = true;

    api.unmute();

    expect(master.gain.value).toBe(0.7);
    expect(ctx.state.muted).toBe(false);
    expect(emit).toHaveBeenCalledWith("audio:muteChanged", { muted: false });
  });

  it("setMuted emits only on an actual change", () => {
    const { api, emit } = bootLive();

    api.setMuted(false); // already false — no change
    expect(emit).not.toHaveBeenCalled();

    api.setMuted(true);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("isMuted reflects state", () => {
    const { api } = bootLive();
    expect(api.isMuted()).toBe(false);
    api.mute();
    expect(api.isMuted()).toBe(true);
  });

  it("headless mute() is a no-op (no emit, no state change)", () => {
    const { api, emit, ctx } = bootHeadless();
    api.mute();
    expect(emit).not.toHaveBeenCalled();
    expect(ctx.state.muted).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setVolume / getVolume
// ─────────────────────────────────────────────────────────────────────────────

describe("audio: volume", () => {
  it("writes the channel gain and emits on change", () => {
    const { api, emit, music, ctx } = bootLive();

    api.setVolume("music", 0.25);

    expect(ctx.state.volumes.music).toBe(0.25);
    expect(music.gain.value).toBe(0.25);
    expect(emit).toHaveBeenCalledWith("audio:volumeChanged", { channel: "music", value: 0.25 });
  });

  it("clamps a value above 1 to 1, writes it to the gain node, and emits", () => {
    const { api, emit, sfx, ctx } = bootLive({ sfxVolume: 0.2 });
    sfx.gain.value = 0.2; // mirror the config (makeLiveEngine defaults nodes to 1)

    api.setVolume("sfx", 1.5);

    expect(ctx.state.volumes.sfx).toBe(1);
    expect(sfx.gain.value).toBe(1); // clamped value actually written
    expect(emit).toHaveBeenCalledWith("audio:volumeChanged", { channel: "sfx", value: 1 });
  });

  it("clamps negative volume to 0", () => {
    const { api, ctx, sfx } = bootLive();
    api.setVolume("sfx", -2);
    expect(ctx.state.volumes.sfx).toBe(0);
    expect(sfx.gain.value).toBe(0);
  });

  it("does not emit when the value is unchanged", () => {
    const { api, emit } = bootLive();
    api.setVolume("master", 1); // already 1
    expect(emit).not.toHaveBeenCalled();
  });

  it("setVolume('master') while muted updates the stored value but keeps the bus at 0", () => {
    const { api, emit, master, ctx } = bootLive();
    api.mute();
    master.gain.value = 0; // muted bus
    emit.mockClear();

    api.setVolume("master", 0.4);

    expect(ctx.state.volumes.master).toBe(0.4);
    expect(master.gain.value).toBe(0); // bus stays muted
    expect(emit).toHaveBeenCalledWith("audio:volumeChanged", { channel: "master", value: 0.4 });

    // Unmuting now restores the bus to the updated stored value.
    api.unmute();
    expect(master.gain.value).toBe(0.4);
  });

  it("getVolume returns the stored channel volume", () => {
    const { api } = bootLive({ musicVolume: 0.6 });
    expect(api.getVolume("music")).toBe(0.6);
  });

  it("getVolume works even headless (pure read)", () => {
    const { api } = bootHeadless({ sfxVolume: 0.3 });
    expect(api.getVolume("sfx")).toBe(0.3);
  });

  it("setVolume headless is a no-op (no emit)", () => {
    const { api, emit } = bootHeadless();
    api.setVolume("sfx", 0.5);
    expect(emit).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WeakMap-miss guards (no engine registered for ctx.global)
// ─────────────────────────────────────────────────────────────────────────────

describe("audio: guards when no engine is registered", () => {
  it("effectful methods no-op without throwing", async () => {
    const { ctx, emit } = makeCtx();
    expect(audioRegistry.has(ctx.global)).toBe(false);
    const api = createApi(ctx);

    await expect(api.unlock()).resolves.toBeUndefined();
    await expect(api.load("x", "u")).resolves.toBeUndefined();
    expect(() => api.play("x")).not.toThrow();
    expect(() => api.playMusic("x")).not.toThrow();
    expect(() => api.stopMusic()).not.toThrow();
    expect(() => api.mute()).not.toThrow();
    expect(() => api.setVolume("sfx", 0.5)).not.toThrow();
    expect(emit).not.toHaveBeenCalled();
  });

  it("getters still return the state mirror", () => {
    const { ctx } = makeCtx({ musicVolume: 0.9 });
    const api = createApi(ctx);
    expect(api.isMuted()).toBe(false);
    expect(api.getVolume("music")).toBe(0.9);
  });
});

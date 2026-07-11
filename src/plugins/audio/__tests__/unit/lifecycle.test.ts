/**
 * @file audio plugin — lifecycle unit tests.
 *
 * Drives start / stop directly against a minimal mock context, covering the
 * live vs. headless engine registration, the headless log.info branch, context
 * teardown, and the idempotent / no-prior-start stop guard.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { audioRegistry } from "../../engine";
import { start, stop } from "../../lifecycle";
import type { Config } from "../../types";
import { installAudioContext } from "../mock-audio-context";

const defaultConfig: Config = {
  masterVolume: 1,
  sfxVolume: 1,
  musicVolume: 1,
  muted: false,
  manifest: {}
};

const makeLog = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

const makeCtx = () => ({ config: defaultConfig, global: {}, log: makeLog() });

/** Remove any WebAudio globals a test installed. */
const clearAudioGlobals = (): void => {
  const globals = globalThis as Record<string, unknown>;
  delete globals.AudioContext;
  delete globals.webkitAudioContext;
};

beforeEach(() => {
  vi.clearAllMocks();
  clearAudioGlobals();
});

afterEach(() => {
  clearAudioGlobals();
});

// ─────────────────────────────────────────────────────────────────────────────
// start
// ─────────────────────────────────────────────────────────────────────────────

describe("audio: lifecycle start", () => {
  it("registers a live engine and does not log info when an AudioContext exists", async () => {
    const { uninstall } = installAudioContext();
    const ctx = makeCtx();

    await start(ctx);
    uninstall();

    expect(audioRegistry.get(ctx.global)?.headless).toBe(false);
    expect(ctx.log.info).not.toHaveBeenCalled();
  });

  it("registers a headless engine and logs info when no AudioContext exists", async () => {
    const ctx = makeCtx();

    await start(ctx);

    expect(audioRegistry.get(ctx.global)?.headless).toBe(true);
    expect(ctx.log.info).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// stop
// ─────────────────────────────────────────────────────────────────────────────

describe("audio: lifecycle stop", () => {
  it("closes the AudioContext and deletes the registry entry", async () => {
    const { instances, uninstall } = installAudioContext();
    const ctx = makeCtx();
    await start(ctx);
    uninstall();

    await stop({ global: ctx.global });

    expect(instances[0]?.close).toHaveBeenCalledTimes(1);
    expect(audioRegistry.has(ctx.global)).toBe(false);
  });

  it("is a safe no-op when called without a prior start", async () => {
    const global = {};
    expect(audioRegistry.has(global)).toBe(false);
    await expect(stop({ global })).resolves.toBeUndefined();
  });

  it("is idempotent — a second stop does not close again or throw", async () => {
    const { instances, uninstall } = installAudioContext();
    const ctx = makeCtx();
    await start(ctx);
    uninstall();

    await stop({ global: ctx.global });
    await expect(stop({ global: ctx.global })).resolves.toBeUndefined();

    expect(instances[0]?.close).toHaveBeenCalledTimes(1);
  });
});

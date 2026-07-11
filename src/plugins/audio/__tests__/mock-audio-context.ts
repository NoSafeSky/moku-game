/**
 * @file audio plugin — shared WebAudio test doubles.
 *
 * A spy-instrumented mock of the structural WebAudio surface the plugin uses,
 * reused by the engine / api unit tests and the integration test. Not a test
 * file itself (no `.test.ts`), so vitest does not collect it.
 */
import { type Mock, vi } from "vitest";
import type {
  AudioBufferSourceNodeLike,
  AudioContextLike,
  GainNodeLike,
  LiveEngine
} from "../engine";
import type { AudioBufferLike } from "../types";

/** A spied AudioParam (gain / playbackRate). */
export type MockParam = {
  value: number;
  setValueAtTime: Mock;
  linearRampToValueAtTime: Mock;
  cancelScheduledValues: Mock;
};

/** A spied GainNode. */
export type MockGain = GainNodeLike & {
  gain: MockParam;
  connect: Mock;
};

/** A spied AudioBufferSourceNode. */
export type MockSource = AudioBufferSourceNodeLike & {
  buffer: AudioBufferLike | undefined;
  loop: boolean;
  playbackRate: MockParam;
  connect: Mock;
  start: Mock;
  stop: Mock;
};

/** A spied AudioContext, exposing the gains/sources it has created for assertions. */
export type MockContext = AudioContextLike & {
  currentTime: number;
  createGain: Mock;
  createBufferSource: Mock;
  decodeAudioData: Mock;
  resume: Mock;
  close: Mock;
  /** All gain nodes created via `createGain`, in creation order. */
  gains: MockGain[];
  /** All buffer sources created via `createBufferSource`, in creation order. */
  sources: MockSource[];
};

/** Build a spied AudioParam with a default value of 1. */
const makeParam = (): MockParam => ({
  value: 1,
  setValueAtTime: vi.fn(),
  linearRampToValueAtTime: vi.fn(),
  cancelScheduledValues: vi.fn()
});

/** Build a spied GainNode. */
export const makeGain = (): MockGain => ({
  gain: makeParam(),
  connect: vi.fn()
});

/** Build a spied AudioBufferSourceNode. */
export const makeSource = (): MockSource => ({
  buffer: undefined,
  loop: false,
  playbackRate: makeParam(),
  connect: vi.fn(),
  start: vi.fn(),
  stop: vi.fn()
});

/** A decoded-buffer stand-in returned by `decodeAudioData`. */
export const fakeBuffer: AudioBufferLike = { duration: 1 };

/**
 * Build a spied AudioContext that records every gain/source it creates.
 * `decodeAudioData` resolves a fake buffer; `resume`/`close` resolve immediately.
 */
export const makeMockAudioContext = (): MockContext => {
  const gains: MockGain[] = [];
  const sources: MockSource[] = [];

  return {
    currentTime: 0,
    destination: { connect: vi.fn() },
    createGain: vi.fn((): MockGain => {
      const gain = makeGain();
      gains.push(gain);
      return gain;
    }),
    createBufferSource: vi.fn((): MockSource => {
      const source = makeSource();
      sources.push(source);
      return source;
    }),
    decodeAudioData: vi.fn(async (): Promise<AudioBufferLike> => fakeBuffer),
    resume: vi.fn(async (): Promise<void> => {}),
    close: vi.fn(async (): Promise<void> => {}),
    gains,
    sources
  };
};

/**
 * Build a live {@link LiveEngine} backed by mock nodes, for api unit tests that
 * seed the registry directly (no globalThis / lifecycle needed). The master /
 * sfx / music channel gains are exposed alongside the context.
 */
export const makeLiveEngine = (): {
  engine: LiveEngine;
  context: MockContext;
  master: MockGain;
  sfx: MockGain;
  music: MockGain;
} => {
  const context = makeMockAudioContext();
  const master = makeGain();
  const sfx = makeGain();
  const music = makeGain();
  const engine: LiveEngine = {
    headless: false,
    context,
    master,
    sfx,
    music,
    musicSource: undefined
  };
  return { engine, context, master, sfx, music };
};

/**
 * Install a mock `AudioContext` constructor on globalThis (for engine /
 * integration tests that build the engine via `createEngine`). Each `new
 * AudioContext()` pushes a fresh {@link MockContext} onto `instances`.
 */
export const installAudioContext = (): {
  instances: MockContext[];
  uninstall: () => void;
} => {
  const instances: MockContext[] = [];

  // A constructor that returns an object → `new Ctor()` yields that object.
  const Ctor = function AudioContextMock(): MockContext {
    const context = makeMockAudioContext();
    instances.push(context);
    return context;
  } as unknown as new () => AudioContextLike;

  const globals = globalThis as { AudioContext?: unknown };
  const previous = globals.AudioContext;
  globals.AudioContext = Ctor;

  return {
    instances,
    uninstall: () => {
      globals.AudioContext = previous;
    }
  };
};

/** Install a mock `fetch` returning `bytes` for any URL. Returns the spy + an uninstall. */
export const installFetch = (
  bytes: ArrayBuffer = new ArrayBuffer(8)
): { fetchMock: Mock; uninstall: () => void } => {
  const globals = globalThis as { fetch?: unknown };
  const previous = globals.fetch;
  const fetchMock = vi.fn(
    async (): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }> => ({
      arrayBuffer: async (): Promise<ArrayBuffer> => bytes
    })
  );
  globals.fetch = fetchMock;

  return {
    fetchMock,
    uninstall: () => {
      globals.fetch = previous;
    }
  };
};

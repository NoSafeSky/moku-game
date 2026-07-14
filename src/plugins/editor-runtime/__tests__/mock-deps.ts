/**
 * @file editor-runtime plugin — shared test doubles.
 *
 * Spy-instrumented fakes of the seven dependency APIs (loop / scheduler / serialization /
 * commands / tween / vfx / camera) plus the `ctx.require` resolver and a spied logger. Reused
 * across the state and api unit tests. Not a test file itself (no `.test.ts`), so vitest does
 * not collect it.
 */
import { type Mock, vi } from "vitest";

import { cameraPlugin } from "../../camera";
import { commandsPlugin } from "../../commands";
import type { RestoreEntity } from "../../commands/types";
import { loopPlugin } from "../../loop";
import type { TimeStepResult } from "../../loop/types";
import { schedulerPlugin } from "../../scheduler";
import type { Stage } from "../../scheduler/types";
import { serializationPlugin } from "../../serialization";
import type { SceneDocument } from "../../serialization/types";
import { tweenPlugin } from "../../tween";
import { vfxPlugin } from "../../vfx";
import type {
  CommandsDep,
  EditorRuntimeRequire,
  Log,
  LoopDep,
  ResettableDep,
  SchedulerDep,
  SerializationDep
} from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Logger
// ─────────────────────────────────────────────────────────────────────────────

/** Build a spied logger. */
export const makeLog = (): Log => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
});

// ─────────────────────────────────────────────────────────────────────────────
// Dependency API fakes
// ─────────────────────────────────────────────────────────────────────────────

/** A spied loop dependency; `step` returns a canned clock. */
export type MockLoop = LoopDep & { start: Mock; step: Mock };

/** Build a spied loop dependency. `stepResult` is returned by every `step()` call. */
export const makeMockLoop = (stepResult: TimeStepResult): MockLoop => ({
  start: vi.fn(),
  step: vi.fn(() => stepResult)
});

/** A spied scheduler dependency recording every `setActiveStages` call. */
export type MockScheduler = SchedulerDep & { setActiveStages: Mock };

/** Build a spied scheduler dependency. */
export const makeMockScheduler = (): MockScheduler => ({
  setActiveStages: vi.fn()
});

/** A spied serialization dependency; `serialize` returns a canned `SceneDocument`. */
export type MockSerialization = SerializationDep & { serialize: Mock };

/** Build a spied serialization dependency. `doc` is returned by every `serialize()` call. */
export const makeMockSerialization = (doc: SceneDocument): MockSerialization => ({
  serialize: vi.fn(() => doc)
});

/** A spied commands dependency recording every `restore` call. */
export type MockCommands = CommandsDep & { restore: Mock };

/** Build a spied commands dependency. */
export const makeMockCommands = (): MockCommands => ({
  restore: vi.fn()
});

/** A spied `reset()`-only dependency (shared shape for tween/vfx/camera). */
export type MockResettable = ResettableDep & { reset: Mock };

/** Build a spied `reset()`-only dependency. */
export const makeMockResettable = (): MockResettable => ({
  reset: vi.fn()
});

// ─────────────────────────────────────────────────────────────────────────────
// require() resolver
// ─────────────────────────────────────────────────────────────────────────────

/** The full set of fakes a `makeRequire` call wires to the seven dependency plugin instances. */
export type MockDeps = {
  loop: MockLoop;
  scheduler: MockScheduler;
  serialization: MockSerialization;
  commands: MockCommands;
  tween: MockResettable;
  vfx: MockResettable;
  camera: MockResettable;
};

/**
 * Build a `ctx.require` resolver mapping each dependency plugin instance to its supplied fake
 * (matched by reference, the same way the kernel resolves deps).
 */
export const makeRequire = (deps: MockDeps): EditorRuntimeRequire => {
  const resolve = (plugin: unknown): unknown => {
    if (plugin === loopPlugin) return deps.loop;
    if (plugin === schedulerPlugin) return deps.scheduler;
    if (plugin === serializationPlugin) return deps.serialization;
    if (plugin === commandsPlugin) return deps.commands;
    if (plugin === tweenPlugin) return deps.tween;
    if (plugin === vfxPlugin) return deps.vfx;
    if (plugin === cameraPlugin) return deps.camera;
    throw new Error("unexpected require");
  };
  return resolve as unknown as EditorRuntimeRequire;
};

/** Build a full set of fresh, spied dependency fakes. */
export const makeMockDeps = (doc: SceneDocument, stepResult: TimeStepResult): MockDeps => ({
  loop: makeMockLoop(stepResult),
  scheduler: makeMockScheduler(),
  serialization: makeMockSerialization(doc),
  commands: makeMockCommands(),
  tween: makeMockResettable(),
  vfx: makeMockResettable(),
  camera: makeMockResettable()
});

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

/** A sentinel `SceneDocument` returned by the fake `serialize()`. */
export const SENTINEL_SCENE: SceneDocument = {
  version: 1,
  name: "untitled",
  entities: [{ id: 1 as RestoreEntity["id"], components: { Position: { x: 1, y: 1 } } }]
};

/** The default `editStages` gate under test. */
export const EDIT_STAGES: readonly Stage[] = ["input", "sync", "render"];

/** Re-exported so test files don't need a second import of the commands RestoreSource type. */
export type { RestoreSource } from "../../commands/types";

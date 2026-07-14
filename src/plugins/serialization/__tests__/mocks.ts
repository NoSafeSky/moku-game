/**
 * @file serialization plugin — shared test doubles.
 *
 * Spy-instrumented mocks of the four dependency APIs (`ecs`/`storage`/`commands`/`reflection`),
 * the `ctx.require` resolver, a spied logger, and a `SerializationApiContext` builder. Reused
 * across the state/serialize/deserialize/persist/migrate/export-import unit suites. Not a test
 * file itself (no `.test.ts`), so vitest does not collect it.
 */
import { type Mock, vi } from "vitest";

import { commandsPlugin } from "../../commands";
import type { Api as CommandsApi, EditorId } from "../../commands/types";
import { ecsPlugin } from "../../ecs";
import type { Entity, World } from "../../ecs/types";
import { reflectionPlugin } from "../../reflection";
import type { Api as ReflectionApi, ValidationResult } from "../../reflection/types";
import { storagePlugin } from "../../storage";
import type { Api as StorageApi } from "../../storage/types";
import type { SerializationApiContext, SerializationRequire } from "../api";
import type { Log } from "../migrate";
import type { Config, State } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Brand helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a branded `EditorId` from a raw number — test-only convenience (mirrors `commands`). */
export const asEditorId = (n: number): EditorId => n as EditorId;

/** Build a branded `Entity` from a raw number — test-only convenience. */
export const asEntity = (n: number): Entity => n as Entity;

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
// Dependency mocks (ecs / commands / reflection / storage)
// ─────────────────────────────────────────────────────────────────────────────

/** A spied `World` slice — only the introspection methods `serialize()` reads. */
export type MockWorld = Pick<World, "liveEntities" | "componentsOf"> & {
  liveEntities: Mock;
  componentsOf: Mock;
};

/** Build a spied world double, seeded empty unless overridden. */
export const makeWorldMock = (overrides: Partial<MockWorld> = {}): MockWorld => ({
  liveEntities: vi.fn(() => []),
  componentsOf: vi.fn(() => []),
  ...overrides
});

/** A spied `commands` slice — `editorIdOf` (capture) and `restore` (the atomic reseed). */
export type MockCommands = Pick<CommandsApi, "editorIdOf" | "restore"> & {
  editorIdOf: Mock;
  restore: Mock;
};

/** Build a spied commands double: no entity is editor-owned, `restore` is a no-op, unless overridden. */
export const makeCommandsMock = (overrides: Partial<MockCommands> = {}): MockCommands => ({
  editorIdOf: vi.fn(() => undefined),
  restore: vi.fn(),
  ...overrides
});

/** A spied `reflection` slice — `validate` only. */
export type MockReflection = Pick<ReflectionApi, "validate"> & { validate: Mock };

/** Build a spied reflection double whose `validate` always accepts, unless given an implementation. */
export const makeReflectionMock = (
  impl: (name: string, partial: Readonly<Record<string, unknown>>) => ValidationResult = () => ({
    ok: true
  })
): MockReflection => ({ validate: vi.fn(impl) });

/** A spied `storage` slice — `get`/`set`/`keys`, backed by an in-memory `Map`. */
export type MockStorage = Pick<StorageApi, "get" | "set" | "keys"> & {
  get: Mock;
  set: Mock;
  keys: Mock;
};

/** Build a spied storage double backed by `store` (defaults to a fresh, empty map). */
export const makeStorageMock = (store: Map<string, unknown> = new Map()): MockStorage => {
  const get = vi.fn((key: string, fallback?: unknown) =>
    store.has(key) ? store.get(key) : fallback
  );
  const set = vi.fn((key: string, value: unknown) => {
    store.set(key, value);
    return true;
  });
  const keys = vi.fn(() => [...store.keys()]);
  return { get, set, keys } as unknown as MockStorage;
};

// ─────────────────────────────────────────────────────────────────────────────
// require() dispatcher + full context builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a `ctx.require` resolver mapping each dependency plugin instance to its supplied mock
 * (matched by reference, the same way the kernel resolves deps).
 */
export const makeRequire = (deps: {
  world: MockWorld;
  storage: MockStorage;
  commands: MockCommands;
  reflection: MockReflection;
}): SerializationRequire => {
  const resolve = (plugin: unknown): unknown => {
    if (plugin === ecsPlugin) return deps.world;
    if (plugin === storagePlugin) return deps.storage;
    if (plugin === commandsPlugin) return deps.commands;
    if (plugin === reflectionPlugin) return deps.reflection;
    throw new Error("unexpected require() in test");
  };
  return resolve as unknown as SerializationRequire;
};

const defaultConfig: Config = { storageKeyPrefix: "scene:", version: 1, migrations: {} };

/** Everything a test gets back from {@link makeCtx} — the context plus each individual mock. */
export type MockCtxBundle = {
  ctx: SerializationApiContext;
  world: MockWorld;
  storage: MockStorage;
  commands: MockCommands;
  reflection: MockReflection;
  log: Log;
  emit: Mock;
};

/**
 * Build a full `SerializationApiContext` with fresh mocks, overridable piece by piece.
 */
export const makeCtx = (
  overrides: {
    config?: Partial<Config>;
    state?: Partial<State>;
    world?: MockWorld;
    storage?: MockStorage;
    commands?: MockCommands;
    reflection?: MockReflection;
    log?: Log;
    emit?: Mock;
  } = {}
): MockCtxBundle => {
  const config: Config = { ...defaultConfig, ...overrides.config };
  const state: State = {
    currentName: undefined,
    currentVersion: config.version,
    ...overrides.state
  };
  const world = overrides.world ?? makeWorldMock();
  const storage = overrides.storage ?? makeStorageMock();
  const commands = overrides.commands ?? makeCommandsMock();
  const reflection = overrides.reflection ?? makeReflectionMock();
  const log = overrides.log ?? makeLog();
  const emit = overrides.emit ?? vi.fn();

  const ctx: SerializationApiContext = {
    config,
    state,
    log,
    require: makeRequire({ world, storage, commands, reflection }),
    emit
  };

  return { ctx, world, storage, commands, reflection, log, emit };
};

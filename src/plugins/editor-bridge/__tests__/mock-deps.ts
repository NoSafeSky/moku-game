/**
 * @file editor-bridge plugin — shared test doubles.
 *
 * Spy-instrumented fakes of the nine dependency APIs (ecs / reflection / commands /
 * editor-selection / editor-gizmos / editor-history / editor-runtime / serialization / mcp), the
 * `ctx.require` resolver, a spied logger, and `EditorBridgeApiContext`/`StartContext` builders.
 * Reused across the state, snapshot, api, and lifecycle unit suites. Not a test file itself (no
 * `.test.ts` suffix), so vitest does not collect it.
 */
import { type Mock, vi } from "vitest";

import { commandsPlugin } from "../../commands";
import type { Api as CommandsApi, EditorId } from "../../commands/types";
import { ecsPlugin } from "../../ecs";
import type { Entity, World } from "../../ecs/types";
import { editorGizmosPlugin } from "../../editor-gizmos";
import type { Api as EditorGizmosApi } from "../../editor-gizmos/types";
import { editorHistoryPlugin } from "../../editor-history";
import type { Api as EditorHistoryApi } from "../../editor-history/types";
import { editorRuntimePlugin } from "../../editor-runtime";
import type { Api as EditorRuntimeApi } from "../../editor-runtime/types";
import { editorSelectionPlugin } from "../../editor-selection";
import type { Api as EditorSelectionApi } from "../../editor-selection/types";
import { mcpPlugin } from "../../mcp";
import type { Api as McpApi } from "../../mcp/types";
import { reflectionPlugin } from "../../reflection";
import type { Api as ReflectionApi } from "../../reflection/types";
import { serializationPlugin } from "../../serialization";
import type { Api as SerializationApi } from "../../serialization/types";
import type { EditorBridgeApiContext } from "../api";
import type { StartContext } from "../lifecycle";
import { createState } from "../state";
import type { Config, EditorBridgeRequire, Log, State } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Brand helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a branded `Entity` from a raw number — test-only convenience. */
export const asEntity = (n: number): Entity => n as Entity;

/** Build a branded `EditorId` from a raw number — test-only convenience. */
export const asEditorId = (n: number): EditorId => n as EditorId;

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

/** A spied `World` slice — `changeEpoch`/`liveEntities`/`componentsOf`. */
export type MockWorld = Pick<World, "changeEpoch" | "liveEntities" | "componentsOf"> & {
  changeEpoch: Mock;
  liveEntities: Mock;
  componentsOf: Mock;
};

/** Build a spied world double: epoch 0, no live entities, unless overridden. */
export const makeWorldMock = (overrides: Partial<MockWorld> = {}): MockWorld => ({
  changeEpoch: vi.fn(() => 0),
  liveEntities: vi.fn(() => []),
  componentsOf: vi.fn(() => []),
  ...overrides
});

/** A spied `reflection` slice — `describe`/`validate`. */
export type MockReflection = Pick<ReflectionApi, "describe" | "validate"> & {
  describe: Mock;
  validate: Mock;
};

/** Build a spied reflection double: empty descriptors, accepting `validate`, unless overridden. */
export const makeReflectionMock = (overrides: Partial<MockReflection> = {}): MockReflection => ({
  describe: vi.fn(() => []),
  validate: vi.fn(() => ({ ok: true }) as const),
  ...overrides
});

/** A spied `commands` slice — `editorIdOf`/`resolve`/`setValidator`. */
export type MockCommands = Pick<CommandsApi, "editorIdOf" | "resolve" | "setValidator"> & {
  editorIdOf: Mock;
  resolve: Mock;
  setValidator: Mock;
};

/** Build a spied commands double: no entity resolves, unless overridden. */
export const makeCommandsMock = (overrides: Partial<MockCommands> = {}): MockCommands => ({
  editorIdOf: vi.fn(() => undefined),
  resolve: vi.fn(() => undefined),
  setValidator: vi.fn(),
  ...overrides
});

/** A spied `editor-selection` slice — `selected`/`clear`/`toggle`. */
export type MockEditorSelection = Pick<EditorSelectionApi, "selected" | "clear" | "toggle"> & {
  selected: Mock;
  clear: Mock;
  toggle: Mock;
};

/** Build a spied editor-selection double: empty selection, unless overridden. */
export const makeEditorSelectionMock = (
  overrides: Partial<MockEditorSelection> = {}
): MockEditorSelection => ({
  selected: vi.fn(() => []),
  clear: vi.fn(),
  toggle: vi.fn(),
  ...overrides
});

/** A spied `editor-gizmos` slice — `setGestureSink` only. */
export type MockEditorGizmos = Pick<EditorGizmosApi, "setGestureSink"> & { setGestureSink: Mock };

/** Build a spied editor-gizmos double. */
export const makeEditorGizmosMock = (): MockEditorGizmos => ({ setGestureSink: vi.fn() });

/** A spied `editor-history` slice — the undo/redo/gesture surface editor-bridge calls. */
export type MockEditorHistory = Pick<
  EditorHistoryApi,
  "applyTracked" | "undo" | "redo" | "canUndo" | "canRedo" | "beginGesture" | "endGesture"
> & {
  applyTracked: Mock;
  undo: Mock;
  redo: Mock;
  canUndo: Mock;
  canRedo: Mock;
  beginGesture: Mock;
  endGesture: Mock;
};

/** Build a spied editor-history double: `applyTracked` accepts, no undo/redo available, unless overridden. */
export const makeEditorHistoryMock = (
  overrides: Partial<MockEditorHistory> = {}
): MockEditorHistory => ({
  applyTracked: vi.fn(
    () => ({ ok: true, inverse: { kind: "despawn", id: asEditorId(1) } }) as const
  ),
  undo: vi.fn(() => true),
  redo: vi.fn(() => true),
  canUndo: vi.fn(() => false),
  canRedo: vi.fn(() => false),
  beginGesture: vi.fn(),
  endGesture: vi.fn(),
  ...overrides
});

/** A spied `editor-runtime` slice — `enterPlay`/`stop`/`step`/`mode`. */
export type MockEditorRuntime = Pick<EditorRuntimeApi, "enterPlay" | "stop" | "step" | "mode"> & {
  enterPlay: Mock;
  stop: Mock;
  step: Mock;
  mode: Mock;
};

/** Build a spied editor-runtime double: `mode()` reads `"edit"`, unless overridden. */
export const makeEditorRuntimeMock = (
  overrides: Partial<MockEditorRuntime> = {}
): MockEditorRuntime => ({
  enterPlay: vi.fn(),
  stop: vi.fn(),
  step: vi.fn(),
  mode: vi.fn(() => "edit" as const),
  ...overrides
});

/** A spied `serialization` slice — `save`/`load`. */
export type MockSerialization = Pick<SerializationApi, "save" | "load"> & {
  save: Mock;
  load: Mock;
};

/** Build a spied serialization double: `save`/`load` succeed, unless overridden. */
export const makeSerializationMock = (
  overrides: Partial<MockSerialization> = {}
): MockSerialization => ({
  save: vi.fn(() => true),
  load: vi.fn(() => true),
  ...overrides
});

/** A spied `mcp` slice — `isRunning`/`clientTransport`. */
export type MockMcp = Pick<McpApi, "isRunning" | "clientTransport"> & {
  isRunning: Mock;
  clientTransport: Mock;
};

/** Build a spied mcp double: running, no in-page transport, unless overridden. */
export const makeMcpMock = (overrides: Partial<MockMcp> = {}): MockMcp => ({
  isRunning: vi.fn(() => true),
  clientTransport: vi.fn(() => undefined),
  ...overrides
});

// ─────────────────────────────────────────────────────────────────────────────
// require() dispatcher
// ─────────────────────────────────────────────────────────────────────────────

/** The full set of fakes a `makeRequire` call wires to the nine dependency plugin instances. */
export type MockDeps = {
  world: MockWorld;
  reflection: MockReflection;
  commands: MockCommands;
  editorSelection: MockEditorSelection;
  editorGizmos: MockEditorGizmos;
  editorHistory: MockEditorHistory;
  editorRuntime: MockEditorRuntime;
  serialization: MockSerialization;
  mcp: MockMcp;
};

/** Build a fresh set of spied dependency fakes. */
export const makeMockDeps = (): MockDeps => ({
  world: makeWorldMock(),
  reflection: makeReflectionMock(),
  commands: makeCommandsMock(),
  editorSelection: makeEditorSelectionMock(),
  editorGizmos: makeEditorGizmosMock(),
  editorHistory: makeEditorHistoryMock(),
  editorRuntime: makeEditorRuntimeMock(),
  serialization: makeSerializationMock(),
  mcp: makeMcpMock()
});

/**
 * Build a `ctx.require` resolver mapping each dependency plugin instance to its supplied fake
 * (matched by reference, the same way the kernel resolves deps).
 */
export const makeRequire = (deps: MockDeps): EditorBridgeRequire => {
  const resolve = (plugin: unknown): unknown => {
    if (plugin === ecsPlugin) return deps.world;
    if (plugin === reflectionPlugin) return deps.reflection;
    if (plugin === commandsPlugin) return deps.commands;
    if (plugin === editorSelectionPlugin) return deps.editorSelection;
    if (plugin === editorGizmosPlugin) return deps.editorGizmos;
    if (plugin === editorHistoryPlugin) return deps.editorHistory;
    if (plugin === editorRuntimePlugin) return deps.editorRuntime;
    if (plugin === serializationPlugin) return deps.serialization;
    if (plugin === mcpPlugin) return deps.mcp;
    throw new Error("unexpected require() in test");
  };
  return resolve as unknown as EditorBridgeRequire;
};

// ─────────────────────────────────────────────────────────────────────────────
// Context builders
// ─────────────────────────────────────────────────────────────────────────────

const defaultConfig: Config = {};

/** Everything a test gets back from {@link makeApiCtx} — the context plus each individual mock. */
export type ApiCtxBundle = { ctx: EditorBridgeApiContext; state: State; log: Log } & MockDeps;

/** Build a full `EditorBridgeApiContext` with fresh mocks, overridable dep by dep. */
export const makeApiCtx = (overrides: Partial<MockDeps> = {}): ApiCtxBundle => {
  const deps = { ...makeMockDeps(), ...overrides };
  const state = createState();
  const log = makeLog();
  const ctx: EditorBridgeApiContext = {
    config: defaultConfig,
    state,
    log,
    require: makeRequire(deps)
  };
  return { ctx, state, log, ...deps };
};

/** Everything a test gets back from {@link makeStartCtx} — the context plus each individual mock. */
export type StartCtxBundle = { ctx: StartContext; log: Log } & MockDeps;

/** Build a full `StartContext` (lifecycle.ts's onStart context) with fresh mocks. */
export const makeStartCtx = (overrides: Partial<MockDeps> = {}): StartCtxBundle => {
  const deps = { ...makeMockDeps(), ...overrides };
  const log = makeLog();
  const ctx: StartContext = { require: makeRequire(deps), log };
  return { ctx, log, ...deps };
};

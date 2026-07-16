/**
 * @file hierarchy plugin — shared test doubles for the unit suites.
 *
 * Spy-instrumented fakes for `ecs` (a minimal Node/Transform-only World), `renderer`, and
 * `commands`, plus the `ctx.require` resolver and `HierarchyApiContext` builder — mirroring the
 * `editor-bridge` `mock-deps.ts` pattern. `api.test.ts` and `system.test.ts` both import from
 * here so entity/world stand-ins stay identical. Not a test file itself (no `.test.ts` suffix),
 * so vitest does not collect it.
 */
import { vi } from "vitest";
import { commandsPlugin } from "../../commands";
import type { Api as CommandsApi, EditorId } from "../../commands/types";
import { ecsPlugin } from "../../ecs";
import type { Component, Entity, World } from "../../ecs/types";
import { rendererPlugin } from "../../renderer";
import type { Api as RendererApi, TransformValue } from "../../renderer/types";
import type { HierarchyApiContext } from "../api";
import { createState } from "../state";
import type { Config, NodeValue, State } from "../types";

/** Build a branded `Entity` from a raw number — test-only convenience. */
export const asEntity = (n: number): Entity => n as Entity;

/** Build a branded `EditorId` from a raw number — test-only convenience. */
export const asEditorId = (n: number): EditorId => n as EditorId;

/** A stable Node component token identity for the fake world's `get`/`query` dispatch. */
export const NODE_TOKEN = { __id: 100 } as unknown as Component<NodeValue>;

/** A stable Transform component token identity for the fake world's `get` dispatch. */
export const TRANSFORM_TOKEN = { __id: 200 } as unknown as Component<TransformValue>;

// ─────────────────────────────────────────────────────────────────────────────
// Fake World (Node + Transform only — the two components hierarchy touches)
// ─────────────────────────────────────────────────────────────────────────────

/** In-memory per-entity component stores + epoch/stage-mode flags backing the fake world. */
export type WorldFixture = {
  /** Entity → its Node value. */
  nodes: Map<Entity, NodeValue>;
  /** Entity → its local Transform value. */
  transforms: Map<Entity, TransformValue>;
  /** The value `world.changeEpoch()` returns. */
  epoch: number;
  /** `true` → `activeStages()` returns a gated (edit-mode) list; `false` → `undefined` (play mode). */
  editStages: boolean;
};

/**
 * Builds an empty world fixture (edit mode, epoch `0`), overridable field by field.
 *
 * @param overrides - Partial fixture fields to override the defaults.
 * @returns A fresh `WorldFixture`.
 * @example
 * ```ts
 * const fixture = makeWorldFixture({ nodes: new Map([[root, rootNode]]) });
 * ```
 */
export const makeWorldFixture = (overrides: Partial<WorldFixture> = {}): WorldFixture => ({
  nodes: new Map(),
  transforms: new Map(),
  epoch: 0,
  editStages: true,
  ...overrides
});

/**
 * Builds a spied `World` double over a `WorldFixture` — only the members hierarchy actually
 * calls (`get`, `query`, `changeEpoch`, `activeStages`).
 *
 * @param fixture - The backing fixture (read live — mutate it between calls to simulate writes).
 * @returns A `World` double.
 * @example
 * ```ts
 * const world = makeWorld(fixture);
 * ```
 */
export const makeWorld = (fixture: WorldFixture): World => {
  const get = vi.fn((entity: Entity, token: unknown) => {
    if (token === NODE_TOKEN) return fixture.nodes.get(entity);
    if (token === TRANSFORM_TOKEN) return fixture.transforms.get(entity);
    return undefined;
  });

  const query = vi.fn(() => ({
    updateEach: (cb: (values: [NodeValue], entity: Entity) => void) => {
      for (const [entity, node] of fixture.nodes) cb([node], entity);
    },
    count: () => fixture.nodes.size,
    first: () => fixture.nodes.keys().next().value,
    [Symbol.iterator]: () => fixture.nodes.keys()
  }));

  return {
    get,
    query,
    changeEpoch: vi.fn(() => fixture.epoch),
    activeStages: vi.fn(() => (fixture.editStages ? (["sync"] as const) : undefined))
  } as unknown as World;
};

// ─────────────────────────────────────────────────────────────────────────────
// Fake commands (resolve / editorIdOf)
// ─────────────────────────────────────────────────────────────────────────────

/** The two EditorId↔Entity maps backing the fake `commands` double. */
export type CommandsFixture = {
  /** EditorId → live Entity. */
  byId: Map<EditorId, Entity>;
  /** Entity → its EditorId. */
  byEntity: Map<Entity, EditorId>;
};

/**
 * Builds an empty commands fixture, overridable field by field.
 *
 * @param overrides - Partial fixture fields to override the defaults.
 * @returns A fresh `CommandsFixture`.
 * @example
 * ```ts
 * const fixture = makeCommandsFixture({ byId: new Map([[rootId, root]]) });
 * ```
 */
export const makeCommandsFixture = (overrides: Partial<CommandsFixture> = {}): CommandsFixture => ({
  byId: new Map(),
  byEntity: new Map(),
  ...overrides
});

/**
 * Builds a spied `commands` API double over a `CommandsFixture`.
 *
 * @param fixture - The backing fixture (read live).
 * @returns A `CommandsApi` double.
 * @example
 * ```ts
 * const commands = makeCommands(fixture);
 * ```
 */
export const makeCommands = (fixture: CommandsFixture): CommandsApi => ({
  apply: vi.fn(),
  applyRaw: vi.fn(),
  restore: vi.fn(),
  resolve: vi.fn((id: EditorId) => fixture.byId.get(id)),
  editorIdOf: vi.fn((entity: Entity) => fixture.byEntity.get(entity)),
  setValidator: vi.fn(),
  count: vi.fn(() => fixture.byEntity.size)
});

// ─────────────────────────────────────────────────────────────────────────────
// Fake renderer (Transform token + the methods the system calls)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a spied `renderer` API double whose `Transform` token is the stable
 * {@link TRANSFORM_TOKEN}.
 *
 * @returns A `RendererApi` double.
 * @example
 * ```ts
 * const renderer = makeRenderer();
 * ```
 */
export const makeRenderer = (): RendererApi => ({
  get Transform(): Component<TransformValue> {
    return TRANSFORM_TOKEN;
  },
  attach: vi.fn(),
  detach: vi.fn(),
  render: vi.fn(),
  getView: vi.fn(() => undefined),
  getStage: vi.fn(() => undefined),
  getEntityView: vi.fn(() => undefined),
  markDirty: vi.fn(),
  screenshot: vi.fn(async () => undefined),
  tree: vi.fn(() => undefined),
  attachPrimitive: vi.fn(() => false),
  attachSprite: vi.fn(() => false),
  setTextureResolver: vi.fn(),
  setWorldTransformResolver: vi.fn(),
  setEntityVisible: vi.fn(),
  setGridVisible: vi.fn()
});

// ─────────────────────────────────────────────────────────────────────────────
// require() dispatcher + full HierarchyApiContext builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a `ctx.require` resolver mapping each dependency plugin instance to its supplied fake
 * (matched by reference, the same way the kernel resolves deps).
 *
 * @param world - The fake World to return for `ecsPlugin`.
 * @param renderer - The fake renderer API to return for `rendererPlugin`.
 * @param commands - The fake commands API to return for `commandsPlugin`.
 * @returns A `require` function typed as `HierarchyApiContext["require"]`.
 * @example
 * ```ts
 * const require = makeRequire(world, renderer, commands);
 * ```
 */
export const makeRequire = (
  world: World,
  renderer: RendererApi,
  commands: CommandsApi
): HierarchyApiContext["require"] => {
  const resolve = (plugin: unknown): unknown => {
    if (plugin === ecsPlugin) return world;
    if (plugin === rendererPlugin) return renderer;
    if (plugin === commandsPlugin) return commands;
    throw new Error("unexpected require() in test");
  };
  return resolve as unknown as HierarchyApiContext["require"];
};

/** Everything {@link makeApiCtx} returns — the context plus each individual fixture/double. */
export type ApiCtxBundle = {
  /** The assembled `HierarchyApiContext`. */
  ctx: HierarchyApiContext;
  /** The fake World (same reference `ctx.require(ecsPlugin)` returns). */
  world: World;
  /** The backing world fixture (mutate `epoch`/`nodes` to simulate writes). */
  worldFixture: WorldFixture;
  /** The fake commands API (same reference `ctx.require(commandsPlugin)` returns). */
  commands: CommandsApi;
  /** The backing commands fixture. */
  commandsFixture: CommandsFixture;
  /** The fake renderer API (same reference `ctx.require(rendererPlugin)` returns). */
  renderer: RendererApi;
  /** The hierarchy plugin state (already started, with the Node token set). */
  state: State;
};

/**
 * Builds a full, already-started `HierarchyApiContext` over the given (or freshly-empty) world +
 * commands fixtures. Takes the fixture OBJECTS directly (rather than a partial-merge) so a
 * caller's later mutation of a fixture field (e.g. bumping `epoch` to simulate a write) is read
 * by the SAME `World`/`commands` doubles the returned `ctx` uses.
 *
 * @param configOverrides - Partial `Config` overrides (default `{ maxDepth: 64 }`).
 * @param worldFixture - The world fixture to back the fake `World` with (default: empty).
 * @param commandsFixture - The commands fixture to back the fake `commands` API with (default: empty).
 * @returns The assembled context plus every individual fixture/double.
 * @example
 * ```ts
 * const { ctx, worldFixture } = makeApiCtx({ maxDepth: 3 }, myWorldFixture, myCommandsFixture);
 * const api = createApi(ctx);
 * worldFixture.epoch += 1; // simulate a write — ctx's world.changeEpoch() reflects it immediately
 * ```
 */
export const makeApiCtx = (
  configOverrides: Partial<Config> = {},
  worldFixture: WorldFixture = makeWorldFixture(),
  commandsFixture: CommandsFixture = makeCommandsFixture()
): ApiCtxBundle => {
  const config: Config = { maxDepth: 64, ...configOverrides };
  const world = makeWorld(worldFixture);
  const commands = makeCommands(commandsFixture);
  const renderer = makeRenderer();
  const state = createState({ global: {}, config });
  state.nodeToken = NODE_TOKEN;
  state.started = true;

  const ctx: HierarchyApiContext = {
    config,
    state,
    require: makeRequire(world, renderer, commands)
  };
  return { ctx, world, worldFixture, commands, commandsFixture, renderer, state };
};

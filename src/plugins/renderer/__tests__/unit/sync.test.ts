/**
 * @file renderer plugin — unit tests for createSyncSystem.
 *
 * Tests the sync stage system: Transform → Container repositioning, dirty-set
 * clearing, and despawn reconciliation (orphaned views disposed).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("pixi.js", () => {
  /** Pixi Container stub — includes children to distinguish from the local test stub. */
  const makePixiContainer = () => ({
    position: { set: vi.fn() },
    rotation: 0,
    scale: { set: vi.fn() },
    destroy: vi.fn(),
    children: [] as unknown[]
  });

  return {
    Application: vi.fn().mockImplementation(() => ({
      init: vi.fn().mockResolvedValue(undefined),
      render: vi.fn(),
      destroy: vi.fn(),
      canvas: {} as HTMLCanvasElement,
      stage: makePixiContainer()
    })),
    Container: vi.fn().mockImplementation(makePixiContainer)
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

import type { Component, Entity, World } from "../../../ecs/types";
import { createState } from "../../state";
import type { SyncContext } from "../../sync";
import { createSyncSystem } from "../../sync";
import type { Config, TransformValue } from "../../types";

const defaultConfig: Config = {
  width: 800,
  height: 600,
  background: 0x00_00_00,
  resolution: 0,
  antialias: true,
  mount: undefined
};

/** Branded entity helper. */
const makeEntity = (n: number): Entity => n as Entity;

/** Create a minimal stub Transform component token. */
const makeTransformToken = (): Component<TransformValue> => {
  const fn = (_v: TransformValue) => ({ component: fn as unknown as Component<never>, value: _v });
  (fn as unknown as { __id: number }).__id = 1;
  (fn as unknown as { __value: TransformValue }).__value = {
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1
  };
  return fn as unknown as Component<TransformValue>;
};

/** Create a stub Container. */
const makeContainer = () => ({
  position: { set: vi.fn() },
  rotation: 0,
  scale: { set: vi.fn() },
  destroy: vi.fn()
});

/** Build a mock World that answers isAlive/get for given entity→transform pairs. */
const makeWorld = (
  aliveMap: Map<Entity, boolean>,
  transformMap: Map<Entity, Partial<TransformValue>>
): World =>
  ({
    defineComponent: vi.fn(),
    spawn: vi.fn(),
    despawn: vi.fn(),
    isAlive: vi.fn((e: Entity) => aliveMap.get(e) ?? true),
    get: vi.fn((_e: Entity, _c: unknown) => transformMap.get(_e as Entity)),
    set: vi.fn(),
    query: vi.fn().mockReturnValue({ updateEach: vi.fn(), count: vi.fn(), first: vi.fn() }),
    add: vi.fn(),
    remove: vi.fn(),
    has: vi.fn(),
    addSystem: vi.fn().mockReturnValue(() => {
      /* no-op */
    }),
    tick: vi.fn(),
    defineTag: vi.fn()
  }) as unknown as World;

const createMockCtx = (world: World): SyncContext => {
  const state = createState({ global: {}, config: defaultConfig });
  const token = makeTransformToken();
  return {
    state,
    transformToken: token,
    world
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// createSyncSystem
// ─────────────────────────────────────────────────────────────────────────────

describe("createSyncSystem", () => {
  describe("repositioning from Transform", () => {
    it("sets container position and rotation for a dirty entity", () => {
      const entity = makeEntity(1);
      const aliveMap = new Map([[entity, true]]);
      const transformMap = new Map<Entity, Partial<TransformValue>>([
        [entity, { x: 10, y: 20, rotation: 0.5, scaleX: 2, scaleY: 3 }]
      ]);
      const world = makeWorld(aliveMap, transformMap);
      const ctx = createMockCtx(world);
      const container = makeContainer();

      ctx.state.views.set(entity, container as never);
      ctx.state.dirty.add(entity);

      const system = createSyncSystem(ctx);
      system(world, 0.016);

      expect(container.position.set).toHaveBeenCalledWith(10, 20);
      expect(container.rotation).toBe(0.5);
      expect(container.scale.set).toHaveBeenCalledWith(2, 3);
    });

    it("clears the dirty set after sync", () => {
      const entity = makeEntity(2);
      const aliveMap = new Map([[entity, true]]);
      const transformMap = new Map<Entity, Partial<TransformValue>>([
        [entity, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }]
      ]);
      const world = makeWorld(aliveMap, transformMap);
      const ctx = createMockCtx(world);
      const container = makeContainer();

      ctx.state.views.set(entity, container as never);
      ctx.state.dirty.add(entity);

      const system = createSyncSystem(ctx);
      system(world, 0);

      expect(ctx.state.dirty.size).toBe(0);
    });

    it("skips dirty entities that have no view", () => {
      const entity = makeEntity(3);
      const world = makeWorld(new Map(), new Map());
      const ctx = createMockCtx(world);

      ctx.state.dirty.add(entity);

      const system = createSyncSystem(ctx);
      expect(() => system(world, 0)).not.toThrow();
      expect(ctx.state.dirty.size).toBe(0);
    });

    it("skips entities with no Transform value", () => {
      const entity = makeEntity(4);
      const aliveMap = new Map([[entity, true]]);
      const transformMap = new Map<Entity, Partial<TransformValue>>();
      const world = makeWorld(aliveMap, transformMap);
      const ctx = createMockCtx(world);
      const container = makeContainer();

      ctx.state.views.set(entity, container as never);
      ctx.state.dirty.add(entity);

      const system = createSyncSystem(ctx);
      system(world, 0);

      expect(container.position.set).not.toHaveBeenCalled();
      expect(ctx.state.dirty.size).toBe(0);
    });
  });

  describe("despawn reconciliation", () => {
    it("disposes and removes views whose entity is dead", () => {
      const liveEntity = makeEntity(10);
      const deadEntity = makeEntity(11);
      const aliveMap = new Map([
        [liveEntity, true],
        [deadEntity, false]
      ]);
      const world = makeWorld(aliveMap, new Map());
      const ctx = createMockCtx(world);
      const liveContainer = makeContainer();
      const deadContainer = makeContainer();

      ctx.state.views.set(liveEntity, liveContainer as never);
      ctx.state.views.set(deadEntity, deadContainer as never);

      const system = createSyncSystem(ctx);
      system(world, 0);

      expect(deadContainer.destroy).toHaveBeenCalled();
      expect(ctx.state.views.has(deadEntity)).toBe(false);
      expect(ctx.state.views.has(liveEntity)).toBe(true);
    });

    it("does not dispose live entity views", () => {
      const entity = makeEntity(12);
      const aliveMap = new Map([[entity, true]]);
      const world = makeWorld(aliveMap, new Map());
      const ctx = createMockCtx(world);
      const container = makeContainer();

      ctx.state.views.set(entity, container as never);

      const system = createSyncSystem(ctx);
      system(world, 0);

      expect(container.destroy).not.toHaveBeenCalled();
    });
  });

  describe("no-op on empty state", () => {
    it("runs without error when views and dirty are empty", () => {
      const world = makeWorld(new Map(), new Map());
      const ctx = createMockCtx(world);

      const system = createSyncSystem(ctx);
      expect(() => system(world, 0.016)).not.toThrow();
    });
  });
});

/**
 * @file renderer plugin — unit tests for the Phase-1 world-resolver sync source.
 *
 * `repositionFromTransform` reads `state.worldResolver?.(entity) ?? world.get(entity,
 * transformToken)`. This file covers the NEW resolver-set path and the regression
 * guarantee: with no resolver installed, positioning is byte-identical to the
 * pre-Phase-1 local-Transform behavior already covered by sync.test.ts.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("pixi.js", () => {
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
// Imports after the mock is declared
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
  mount: undefined,
  headless: false
};

const makeEntity = (n: number): Entity => n as Entity;

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

const makeContainer = () => ({
  position: { set: vi.fn() },
  rotation: 0,
  scale: { set: vi.fn() },
  destroy: vi.fn()
});

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
  return {
    state,
    transformToken: makeTransformToken(),
    world
  };
};

describe("createSyncSystem — Phase-1 world-resolver source", () => {
  it("positions from the world resolver when one is installed, ignoring the local Transform", () => {
    const entity = makeEntity(1);
    const aliveMap = new Map([[entity, true]]);
    // Local Transform deliberately differs from the world-space value.
    const transformMap = new Map<Entity, Partial<TransformValue>>([
      [entity, { x: 1, y: 1, rotation: 0, scaleX: 1, scaleY: 1 }]
    ]);
    const world = makeWorld(aliveMap, transformMap);
    const ctx = createMockCtx(world);
    const container = makeContainer();
    const worldValue: TransformValue = { x: 500, y: 600, rotation: 1.5, scaleX: 4, scaleY: 5 };
    const resolver = vi.fn().mockReturnValue(worldValue);
    ctx.state.worldResolver = resolver;

    ctx.state.views.set(entity, container as never);
    ctx.state.dirty.add(entity);

    const system = createSyncSystem(ctx);
    system(world, 0.016);

    expect(resolver).toHaveBeenCalledWith(entity);
    expect(container.position.set).toHaveBeenCalledWith(500, 600);
    expect(container.rotation).toBe(1.5);
    expect(container.scale.set).toHaveBeenCalledWith(4, 5);
    // The local Transform value must NOT have been used.
    expect(container.position.set).not.toHaveBeenCalledWith(1, 1);
  });

  it("falls back to the local Transform when the resolver returns undefined for this entity", () => {
    const entity = makeEntity(2);
    const aliveMap = new Map([[entity, true]]);
    const transformMap = new Map<Entity, Partial<TransformValue>>([
      [entity, { x: 7, y: 8, rotation: 0, scaleX: 1, scaleY: 1 }]
    ]);
    const world = makeWorld(aliveMap, transformMap);
    const ctx = createMockCtx(world);
    const container = makeContainer();
    ctx.state.worldResolver = vi.fn().mockReturnValue(undefined);

    ctx.state.views.set(entity, container as never);
    ctx.state.dirty.add(entity);

    const system = createSyncSystem(ctx);
    system(world, 0);

    expect(container.position.set).toHaveBeenCalledWith(7, 8);
  });

  it("falls back to the local Transform byte-identically when no resolver is installed (regression)", () => {
    const entity = makeEntity(3);
    const aliveMap = new Map([[entity, true]]);
    const transformMap = new Map<Entity, Partial<TransformValue>>([
      [entity, { x: 10, y: 20, rotation: 0.5, scaleX: 2, scaleY: 3 }]
    ]);
    const world = makeWorld(aliveMap, transformMap);
    const ctx = createMockCtx(world);
    const container = makeContainer();
    // worldResolver stays undefined — the flat-app default from createState.

    ctx.state.views.set(entity, container as never);
    ctx.state.dirty.add(entity);

    const system = createSyncSystem(ctx);
    system(world, 0);

    expect(container.position.set).toHaveBeenCalledWith(10, 20);
    expect(container.rotation).toBe(0.5);
    expect(container.scale.set).toHaveBeenCalledWith(2, 3);
  });
});

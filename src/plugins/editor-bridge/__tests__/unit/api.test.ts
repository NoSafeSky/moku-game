/**
 * @file editor-bridge plugin — API unit tests.
 *
 * Drives `createApi` against fresh state and spied dependency fakes resolved through a fake
 * `require` (see `../mock-deps.ts`). Covers: `snapshot()`'s aggregation + epoch-memoization of the
 * STRUCTURAL tree (`entities` AND `roots` share the same memoized reference between unchanged-epoch
 * calls, both rebuilt on a bump, cheap scalars read fresh every call); `apply`/`setField` routing
 * through `editor-history.applyTracked`; the twelve authoring verbs (`create*`, `delete`/
 * `duplicate`/`reparent` delegating to the pure `authoring.ts` orchestrators, `reorder`/`rename`/
 * `setEnabled`/`addComponent`/`removeComponent`, `listComponents`); `select`/`clearSelection`
 * routing through `editor-selection` (with the skipped-id warning); and the `undo`/`redo`/`play`/
 * `stop`/`step`/`save`/`load`/`describe` forwards.
 */
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { createApi } from "../../api";
import {
  asEditorId,
  asEntity,
  makeApiCtx,
  makeCommandsMock,
  makeComponentRegistryMock,
  makeEditorHistoryMock,
  makeEditorRuntimeMock,
  makeEditorSelectionMock,
  makeHierarchyMock,
  makeReflectionMock,
  makeSerializationMock,
  makeWorldMock
} from "../mock-deps";

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// snapshot()
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-bridge api — snapshot()", () => {
  it("aggregates epoch/entities/roots/selection/mode/canUndo/canRedo from the eleven deps and freezes it", () => {
    const entity = asEntity(1);
    const editorId = asEditorId(10);
    const rootId = asEditorId(20);
    const world = makeWorldMock({
      changeEpoch: vi.fn(() => 3),
      liveEntities: vi.fn(() => [entity]),
      componentsOf: vi.fn(() => [{ name: "Transform", value: { x: 1, y: 2 } }])
    });
    const commands = makeCommandsMock({ editorIdOf: vi.fn(() => editorId) });
    const reflection = makeReflectionMock({ describe: vi.fn(() => []) });
    const hierarchy = makeHierarchyMock({ roots: vi.fn(() => [rootId]) });
    const editorSelection = makeEditorSelectionMock({ selected: vi.fn(() => [entity]) });
    const editorRuntime = makeEditorRuntimeMock({ mode: vi.fn(() => "play" as const) });
    const editorHistory = makeEditorHistoryMock({
      canUndo: vi.fn(() => true),
      canRedo: vi.fn(() => false)
    });
    const { ctx } = makeApiCtx({
      world,
      commands,
      reflection,
      hierarchy,
      editorSelection,
      editorRuntime,
      editorHistory
    });
    const api = createApi(ctx);

    const snapshot = api.snapshot();

    expect(snapshot.epoch).toBe(3);
    expect(snapshot.entities).toEqual([
      {
        id: editorId,
        name: "",
        enabled: true,
        parent: undefined,
        children: [],
        components: [{ name: "Transform", value: { x: 1, y: 2 }, fields: [] }]
      }
    ]);
    expect(snapshot.roots).toEqual([rootId]);
    expect(snapshot.selection).toEqual([editorId]);
    expect(snapshot.mode).toBe("play");
    expect(snapshot.canUndo).toBe(true);
    expect(snapshot.canRedo).toBe(false);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.selection)).toBe(true);
    expect(Object.isFrozen(snapshot.roots)).toBe(true);
  });

  it("memoizes the STRUCTURAL tree (entities AND roots) by epoch: unchanged epoch reuses the same references; a bump rebuilds both", () => {
    const entity = asEntity(1);
    let epoch = 0;
    const world = makeWorldMock({
      changeEpoch: vi.fn(() => epoch),
      liveEntities: vi.fn(() => [entity]),
      componentsOf: vi.fn(() => [{ name: "Transform", value: { x: 0, y: 0 } }])
    });
    const commands = makeCommandsMock({ editorIdOf: vi.fn(() => asEditorId(1)) });
    const hierarchy = makeHierarchyMock({ roots: vi.fn(() => [asEditorId(1)]) });
    const { ctx } = makeApiCtx({ world, commands, hierarchy });
    const api = createApi(ctx);

    const first = api.snapshot();
    const second = api.snapshot();
    expect(second.entities).toBe(first.entities);
    expect(second.roots).toBe(first.roots);
    expect(world.componentsOf).toHaveBeenCalledTimes(1);
    expect(hierarchy.roots).toHaveBeenCalledTimes(1);

    epoch = 1;
    const third = api.snapshot();
    expect(third.entities).not.toBe(first.entities);
    expect(third.roots).not.toBe(first.roots);
    expect(world.componentsOf).toHaveBeenCalledTimes(2);
    expect(hierarchy.roots).toHaveBeenCalledTimes(2);
  });

  it("re-reads the cheap scalars fresh every call even when epoch is unchanged", () => {
    const editorSelection = makeEditorSelectionMock();
    const editorRuntime = makeEditorRuntimeMock();
    const editorHistory = makeEditorHistoryMock();
    const { ctx } = makeApiCtx({ editorSelection, editorRuntime, editorHistory });
    const api = createApi(ctx);

    api.snapshot();
    api.snapshot();

    expect(editorSelection.selected).toHaveBeenCalledTimes(2);
    expect(editorRuntime.mode).toHaveBeenCalledTimes(2);
    expect(editorHistory.canUndo).toHaveBeenCalledTimes(2);
    expect(editorHistory.canRedo).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// apply() / setField()
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-bridge api — apply()/setField() route through editor-history", () => {
  it("apply forwards the command to editorHistory.applyTracked and relays its CommandResult", () => {
    const result = { ok: true as const, inverse: { kind: "despawn" as const, id: asEditorId(5) } };
    const editorHistory = makeEditorHistoryMock({ applyTracked: vi.fn(() => result) });
    const { ctx } = makeApiCtx({ editorHistory });
    const api = createApi(ctx);
    const command = { kind: "despawn" as const, id: asEditorId(5) };

    const returned = api.apply(command);

    expect(editorHistory.applyTracked).toHaveBeenCalledWith(command);
    expect(returned).toBe(result);
  });

  it("setField builds a setField command and forwards it to editorHistory.applyTracked", () => {
    const editorHistory = makeEditorHistoryMock();
    const { ctx } = makeApiCtx({ editorHistory });
    const api = createApi(ctx);
    const id = asEditorId(7);

    api.setField(id, "Transform", "x", 42);

    expect(editorHistory.applyTracked).toHaveBeenCalledWith({
      kind: "setField",
      id,
      component: "Transform",
      field: "x",
      value: 42
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// create() / createShape() / createSprite()
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-bridge api — create()/createShape()/createSprite()", () => {
  it("create spawns Transform+Node (order from hierarchy.orderBetween) and returns the minted id", () => {
    const editorHistory = makeEditorHistoryMock({
      applyTracked: vi.fn(
        () => ({ ok: true, inverse: { kind: "despawn", id: asEditorId(11) } }) as const
      )
    });
    const hierarchy = makeHierarchyMock({ orderBetween: vi.fn(() => 0) });
    const { ctx } = makeApiCtx({ editorHistory, hierarchy });
    const api = createApi(ctx);

    const id = api.create({ name: "Enemies" });

    expect(id).toBe(asEditorId(11));
    expect(editorHistory.applyTracked).toHaveBeenCalledWith({
      kind: "spawn",
      components: {
        Transform: {},
        Node: { parent: undefined, order: 0, name: "Enemies", enabled: true }
      }
    });
  });

  it("createShape overlays Shape defaults from component-registry + opts.shape, and returns the minted id", () => {
    const editorHistory = makeEditorHistoryMock({
      applyTracked: vi.fn(
        () => ({ ok: true, inverse: { kind: "despawn", id: asEditorId(12) } }) as const
      )
    });
    const componentRegistry = makeComponentRegistryMock({
      get: vi.fn((name: string) =>
        name === "Shape"
          ? {
              name: "Shape",
              category: "Rendering" as const,
              defaults: {
                kind: "rect",
                width: 100,
                height: 100,
                radius: 50,
                fill: "#cccccc",
                stroke: "#000000",
                strokeWidth: 0
              },
              addable: true
            }
          : undefined
      )
    });
    const hierarchy = makeHierarchyMock({ orderBetween: vi.fn(() => 0) });
    const parent = asEditorId(5);
    const { ctx } = makeApiCtx({ editorHistory, componentRegistry, hierarchy });
    const api = createApi(ctx);

    const id = api.createShape("rect", { name: "Grunt", parent, shape: { fill: "#D9534F" } });

    expect(id).toBe(asEditorId(12));
    const call = editorHistory.applyTracked.mock.calls[0]?.[0];
    expect(call.kind).toBe("spawn");
    expect(call.components.Node).toEqual({ parent, order: 0, name: "Grunt", enabled: true });
    expect(call.components.Shape).toEqual({
      kind: "rect",
      width: 100,
      height: 100,
      radius: 50,
      fill: "#D9534F",
      stroke: "#000000",
      strokeWidth: 0
    });
  });

  it("createSprite binds SpriteRenderer.sprite to alias and returns the minted id", () => {
    const editorHistory = makeEditorHistoryMock({
      applyTracked: vi.fn(
        () => ({ ok: true, inverse: { kind: "despawn", id: asEditorId(13) } }) as const
      )
    });
    const componentRegistry = makeComponentRegistryMock({
      get: vi.fn((name: string) =>
        name === "SpriteRenderer"
          ? {
              name: "SpriteRenderer",
              category: "Rendering" as const,
              defaults: {
                sprite: "",
                tint: "#ffffff",
                flipX: false,
                sortingLayer: "Default",
                orderInLayer: 0
              },
              addable: true
            }
          : undefined
      )
    });
    const { ctx } = makeApiCtx({ editorHistory, componentRegistry });
    const api = createApi(ctx);

    const id = api.createSprite("hero.png", { name: "Hero" });

    expect(id).toBe(asEditorId(13));
    const call = editorHistory.applyTracked.mock.calls[0]?.[0];
    expect(call.components.SpriteRenderer).toEqual({
      sprite: "hero.png",
      tint: "#ffffff",
      flipX: false,
      sortingLayer: "Default",
      orderInLayer: 0
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// delete() / duplicate() / reparent() — delegate to authoring.ts
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-bridge api — delete()/duplicate()/reparent() delegate to the authoring orchestrators", () => {
  it("delete despawns the given id (no children) in one gesture", () => {
    const editorHistory = makeEditorHistoryMock();
    const hierarchy = makeHierarchyMock({ childrenOf: vi.fn(() => []) });
    const { ctx } = makeApiCtx({ editorHistory, hierarchy });
    const api = createApi(ctx);
    const id = asEditorId(1);

    api.delete(id);

    expect(editorHistory.beginGesture).toHaveBeenCalledTimes(1);
    expect(editorHistory.applyTracked).toHaveBeenCalledWith({ kind: "despawn", id });
    expect(editorHistory.endGesture).toHaveBeenCalledTimes(1);
  });

  it("duplicate clones the given id and SELECTS the returned clone id", () => {
    const clonedId = asEditorId(50);
    const clonedEntity = asEntity(50);
    const editorHistory = makeEditorHistoryMock({
      applyTracked: vi.fn(() => ({ ok: true, inverse: { kind: "despawn", id: clonedId } }) as const)
    });
    const commands = makeCommandsMock({
      resolve: vi.fn((resolveId: unknown) => (resolveId === clonedId ? clonedEntity : asEntity(1))),
      editorIdOf: vi.fn(() => undefined)
    });
    // Typed as the bare (any-based) `Mock` — `World.get` is generic over `T`, and a concrete
    // `NodeValue`-returning stub is not itself assignable to `<T>(...) => T | undefined`.
    const worldGet: Mock = vi.fn(() => ({ parent: undefined, order: 0, name: "X", enabled: true }));
    const world = makeWorldMock({ get: worldGet });
    const hierarchy = makeHierarchyMock({ childrenOf: vi.fn(() => []) });
    const editorSelection = makeEditorSelectionMock();
    const { ctx } = makeApiCtx({ editorHistory, commands, world, hierarchy, editorSelection });
    const api = createApi(ctx);
    const id = asEditorId(1);

    const clones = api.duplicate(id);

    expect(clones).toEqual([clonedId]);
    expect(editorSelection.clear).toHaveBeenCalledTimes(1);
    expect(editorSelection.toggle).toHaveBeenCalledWith(clonedEntity);
  });

  it("reparent short-circuits on hierarchy.canReparent -> false with NO gesture", () => {
    const editorHistory = makeEditorHistoryMock();
    const hierarchy = makeHierarchyMock({ canReparent: vi.fn(() => false) });
    const { ctx } = makeApiCtx({ editorHistory, hierarchy });
    const api = createApi(ctx);

    const result = api.reparent(asEditorId(1), asEditorId(2));

    expect(result.ok).toBe(false);
    expect(editorHistory.beginGesture).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// reorder() / rename() / setEnabled() / addComponent() / removeComponent()
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-bridge api — reorder()/rename()/setEnabled()/addComponent()/removeComponent()", () => {
  it("reorder computes hierarchy.orderBetween(hierarchy.parentOf(entity), before, after) and setFields Node.order", () => {
    const entity = asEntity(1);
    const id = asEditorId(1);
    const parentId = asEditorId(2);
    const before = asEditorId(3);
    const after = asEditorId(4);
    const commands = makeCommandsMock({ resolve: vi.fn(() => entity) });
    const hierarchy = makeHierarchyMock({
      parentOf: vi.fn(() => parentId),
      orderBetween: vi.fn(() => 1.5)
    });
    const editorHistory = makeEditorHistoryMock();
    const { ctx } = makeApiCtx({ commands, hierarchy, editorHistory });
    const api = createApi(ctx);

    api.reorder(id, before, after);

    expect(hierarchy.parentOf).toHaveBeenCalledWith(entity);
    expect(hierarchy.orderBetween).toHaveBeenCalledWith(parentId, before, after);
    expect(editorHistory.applyTracked).toHaveBeenCalledWith({
      kind: "setField",
      id,
      component: "Node",
      field: "order",
      value: 1.5
    });
  });

  it("rename setFields Node.name", () => {
    const editorHistory = makeEditorHistoryMock();
    const { ctx } = makeApiCtx({ editorHistory });
    const api = createApi(ctx);
    const id = asEditorId(1);

    api.rename(id, "Boss Grunt");

    expect(editorHistory.applyTracked).toHaveBeenCalledWith({
      kind: "setField",
      id,
      component: "Node",
      field: "name",
      value: "Boss Grunt"
    });
  });

  it("setEnabled setFields Node.enabled", () => {
    const editorHistory = makeEditorHistoryMock();
    const { ctx } = makeApiCtx({ editorHistory });
    const api = createApi(ctx);
    const id = asEditorId(1);

    api.setEnabled(id, false);

    expect(editorHistory.applyTracked).toHaveBeenCalledWith({
      kind: "setField",
      id,
      component: "Node",
      field: "enabled",
      value: false
    });
  });

  it("addComponent merges component-registry defaults into the addComponent command", () => {
    const componentRegistry = makeComponentRegistryMock({
      get: vi.fn(() => ({
        name: "Shape",
        category: "Rendering" as const,
        defaults: { kind: "rect" },
        addable: true
      }))
    });
    const editorHistory = makeEditorHistoryMock();
    const { ctx } = makeApiCtx({ componentRegistry, editorHistory });
    const api = createApi(ctx);
    const id = asEditorId(1);

    api.addComponent(id, "Shape");

    expect(editorHistory.applyTracked).toHaveBeenCalledWith({
      kind: "addComponent",
      id,
      component: "Shape",
      value: { kind: "rect" }
    });
  });

  it("removeComponent forwards a removeComponent command; neither touches world directly", () => {
    const world = makeWorldMock();
    const editorHistory = makeEditorHistoryMock();
    const { ctx } = makeApiCtx({ world, editorHistory });
    const api = createApi(ctx);
    const id = asEditorId(1);

    api.removeComponent(id, "Shape");

    expect(editorHistory.applyTracked).toHaveBeenCalledWith({
      kind: "removeComponent",
      id,
      component: "Shape"
    });
    expect(world.get).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// listComponents()
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-bridge api — listComponents()", () => {
  it("returns component-registry.list() enriched with reflection.describe(name), frozen", () => {
    const entry = { name: "Shape", category: "Rendering" as const, defaults: {}, addable: true };
    const fields = [{ kind: "string" as const, key: "fill", label: "Fill" }];
    const componentRegistry = makeComponentRegistryMock({ list: vi.fn(() => [entry]) });
    const reflection = makeReflectionMock({ describe: vi.fn(() => fields) });
    const { ctx } = makeApiCtx({ componentRegistry, reflection });
    const api = createApi(ctx);

    const catalog = api.listComponents();

    expect(catalog).toEqual([{ ...entry, fields }]);
    expect(reflection.describe).toHaveBeenCalledWith("Shape");
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog[0])).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// select() / clearSelection()
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-bridge api — select()/clearSelection()", () => {
  it("clears then resolves + toggles each id in order", () => {
    const entityA = asEntity(1);
    const entityB = asEntity(2);
    const idA = asEditorId(1);
    const idB = asEditorId(2);
    const commands = makeCommandsMock({
      resolve: vi.fn((id: unknown) => {
        if (id === idA) return entityA;
        if (id === idB) return entityB;
        return undefined;
      })
    });
    const editorSelection = makeEditorSelectionMock();
    const { ctx } = makeApiCtx({ commands, editorSelection });
    const api = createApi(ctx);

    api.select(idA, idB);

    expect(editorSelection.clear).toHaveBeenCalledTimes(1);
    expect(editorSelection.toggle).toHaveBeenNthCalledWith(1, entityA);
    expect(editorSelection.toggle).toHaveBeenNthCalledWith(2, entityB);
  });

  it("skips an id whose resolve is undefined, logging a warning", () => {
    const commands = makeCommandsMock({ resolve: vi.fn(() => undefined) });
    const editorSelection = makeEditorSelectionMock();
    const { ctx, log } = makeApiCtx({ commands, editorSelection });
    const api = createApi(ctx);
    const deadId = asEditorId(99);

    api.select(deadId);

    expect(editorSelection.toggle).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      `[editor-bridge] select — editor id ${deadId} not alive; skipped.`
    );
  });

  it("clearSelection forwards to editorSelection.clear", () => {
    const editorSelection = makeEditorSelectionMock();
    const { ctx } = makeApiCtx({ editorSelection });
    const api = createApi(ctx);

    api.clearSelection();

    expect(editorSelection.clear).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// undo/redo, play/stop/step, save/load, describe
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-bridge api — runtime/persistence/describe forwards", () => {
  it("undo/redo forward to editorHistory", () => {
    const editorHistory = makeEditorHistoryMock();
    const { ctx } = makeApiCtx({ editorHistory });
    const api = createApi(ctx);

    api.undo();
    api.redo();

    expect(editorHistory.undo).toHaveBeenCalledTimes(1);
    expect(editorHistory.redo).toHaveBeenCalledTimes(1);
  });

  it("play/stop/step forward to editorRuntime", () => {
    const editorRuntime = makeEditorRuntimeMock();
    const { ctx } = makeApiCtx({ editorRuntime });
    const api = createApi(ctx);

    api.play();
    api.stop();
    api.step();

    expect(editorRuntime.enterPlay).toHaveBeenCalledTimes(1);
    expect(editorRuntime.stop).toHaveBeenCalledTimes(1);
    expect(editorRuntime.step).toHaveBeenCalledTimes(1);
  });

  it("save/load forward to serialization and relay the boolean", () => {
    const serialization = makeSerializationMock({
      save: vi.fn(() => true),
      load: vi.fn(() => false)
    });
    const { ctx } = makeApiCtx({ serialization });
    const api = createApi(ctx);

    expect(api.save("s1")).toBe(true);
    expect(api.load("s1")).toBe(false);
    expect(serialization.save).toHaveBeenCalledWith("s1");
    expect(serialization.load).toHaveBeenCalledWith("s1");
  });

  it("describe forwards to reflection.describe", () => {
    const fields = [{ kind: "number" as const, key: "x", label: "X" }];
    const reflection = makeReflectionMock({ describe: vi.fn(() => fields) });
    const { ctx } = makeApiCtx({ reflection });
    const api = createApi(ctx);

    expect(api.describe("Transform")).toBe(fields);
    expect(reflection.describe).toHaveBeenCalledWith("Transform");
  });
});

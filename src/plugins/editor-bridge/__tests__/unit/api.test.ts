/**
 * @file editor-bridge plugin — API unit tests.
 *
 * Drives `createApi` against fresh state and spied dependency fakes resolved through a fake
 * `require` (see `../mock-deps.ts`). Covers: `snapshot()`'s aggregation + epoch-memoization
 * (same `entities` reference between unchanged-epoch calls, rebuilt on a bump, cheap scalars read
 * fresh every call); `apply`/`setField` routing through `editor-history.applyTracked`;
 * `select`/`clearSelection` routing through `editor-selection` (with the skipped-id warning); and
 * the `undo`/`redo`/`play`/`stop`/`step`/`save`/`load`/`describe` forwards.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApi } from "../../api";
import {
  asEditorId,
  asEntity,
  makeApiCtx,
  makeCommandsMock,
  makeEditorHistoryMock,
  makeEditorRuntimeMock,
  makeEditorSelectionMock,
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
  it("aggregates epoch/entities/selection/mode/canUndo/canRedo from the nine deps and freezes it", () => {
    const entity = asEntity(1);
    const editorId = asEditorId(10);
    const world = makeWorldMock({
      changeEpoch: vi.fn(() => 3),
      liveEntities: vi.fn(() => [entity]),
      componentsOf: vi.fn(() => [{ name: "Transform", value: { x: 1, y: 2 } }])
    });
    const commands = makeCommandsMock({ editorIdOf: vi.fn(() => editorId) });
    const reflection = makeReflectionMock({ describe: vi.fn(() => []) });
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
      editorSelection,
      editorRuntime,
      editorHistory
    });
    const api = createApi(ctx);

    const snapshot = api.snapshot();

    expect(snapshot.epoch).toBe(3);
    expect(snapshot.entities).toEqual([
      { id: editorId, components: [{ name: "Transform", value: { x: 1, y: 2 }, fields: [] }] }
    ]);
    expect(snapshot.selection).toEqual([editorId]);
    expect(snapshot.mode).toBe("play");
    expect(snapshot.canUndo).toBe(true);
    expect(snapshot.canRedo).toBe(false);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.selection)).toBe(true);
  });

  it("memoizes entities by epoch: unchanged epoch reuses the same reference; a bump rebuilds", () => {
    const entity = asEntity(1);
    let epoch = 0;
    const world = makeWorldMock({
      changeEpoch: vi.fn(() => epoch),
      liveEntities: vi.fn(() => [entity]),
      componentsOf: vi.fn(() => [{ name: "Transform", value: { x: 0, y: 0 } }])
    });
    const commands = makeCommandsMock({ editorIdOf: vi.fn(() => asEditorId(1)) });
    const { ctx } = makeApiCtx({ world, commands });
    const api = createApi(ctx);

    const first = api.snapshot();
    const second = api.snapshot();
    expect(second.entities).toBe(first.entities);
    expect(world.componentsOf).toHaveBeenCalledTimes(1);

    epoch = 1;
    const third = api.snapshot();
    expect(third.entities).not.toBe(first.entities);
    expect(world.componentsOf).toHaveBeenCalledTimes(2);
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

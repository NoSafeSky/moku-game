/**
 * @file editor-selection plugin — API surface unit tests.
 *
 * Exercises `app["editor-selection"]` via `createApi` with a minimal mock ctx
 * (`{ config, state, log, emit }`, `emit` a spy) and a stub `world` exposing only
 * `isAlive`. Covers the pure selection-set model — `select` (single-select REPLACES;
 * `multiSelect: true` ADDS), `toggle` (flips membership), `clear` (empties) — the
 * "emit only on real change" gate, `selected()`/`isSelected()` reading + pruning
 * despawned entities, and the before-start guard (mutators + `pickAt` + `selected()`
 * no-op; `isSelected` is a pure reader that works before start). Also covers
 * `selectInRect`'s world-space AABB hit-test over `liveEntities()` (additive union vs
 * replace, despawn pruning, one emit per real change). `enable`/`disable`/`pickAt`'s
 * Pixi-facing behaviour is covered in `pick.test.ts`.
 */
import type { Container } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import type { Entity, World } from "../../../ecs/types";
import type { Api as RendererApi } from "../../../renderer/types";
import { createApi, type EditorSelectionApiContext } from "../../api";
import { createState } from "../../state";
import type { Config } from "../../types";

const asEntity = (n: number): Entity => n as Entity;

const makeConfig = (over: Partial<Config> = {}): Config => ({
  pickLayer: "world",
  multiSelect: false,
  marquee: true,
  ...over
});

const makeLog = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

/** A minimal fake World double exposing only `isAlive`, backed by a mutable alive Set. */
const makeWorld = (aliveEntities: readonly Entity[] = []): { world: World; alive: Set<Entity> } => {
  const alive = new Set(aliveEntities);
  const world = { isAlive: (e: Entity) => alive.has(e) } as unknown as World;
  return { world, alive };
};

/** A NOT-started ctx (no captured deps) — for before-start guard assertions. */
const unstartedCtx = (over: Partial<Config> = {}) => {
  const config = makeConfig(over);
  const state = createState({ global: {}, config });
  const log = makeLog();
  const emit = vi.fn();
  const ctx: EditorSelectionApiContext = { config, state, log, emit };
  return { api: createApi(ctx), ctx, state, log, emit };
};

/** A STARTED ctx with a stub world seeded with the given alive entities. */
const startedCtx = (over: Partial<Config> = {}, aliveEntities: readonly Entity[] = []) => {
  const config = makeConfig(over);
  const state = createState({ global: {}, config });
  const { world, alive } = makeWorld(aliveEntities);
  state.world = world;
  state.started = true;
  const log = makeLog();
  const emit = vi.fn();
  const ctx: EditorSelectionApiContext = { config, state, log, emit };
  return { api: createApi(ctx), ctx, state, log, emit, alive };
};

describe("editor-selection — api", () => {
  describe("before start", () => {
    it("guards select/toggle/clear/enable/disable/pickAt as no-ops and warns", () => {
      const { api, log, emit } = unstartedCtx();
      const entity = asEntity(1);

      api.select(entity);
      api.toggle(entity);
      api.clear();
      api.enable();
      api.disable();

      expect(emit).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalled();
      expect(api.pickAt({ x: 0, y: 0 })).toBeUndefined();
    });

    it("selected() returns [] before start; isSelected is a pure reader that works before start", () => {
      const { api } = unstartedCtx();
      const entity = asEntity(1);
      expect(api.selected()).toEqual([]);
      expect(api.isSelected(entity)).toBe(false);
    });
  });

  describe("select", () => {
    it("single-select REPLACES the selection with just the given entity", () => {
      const e1 = asEntity(1);
      const e2 = asEntity(2);
      const { api, emit } = startedCtx({}, [e1, e2]);

      api.select(e1);
      expect(api.selected()).toEqual([e1]);

      api.select(e2);
      expect(api.selected()).toEqual([e2]);
      expect(emit).toHaveBeenCalledTimes(2);
    });

    it("multiSelect ADDS to the selection", () => {
      const e1 = asEntity(1);
      const e2 = asEntity(2);
      const { api } = startedCtx({ multiSelect: true }, [e1, e2]);

      api.select(e1);
      api.select(e2);
      expect(new Set(api.selected())).toEqual(new Set([e1, e2]));
    });

    it("ignores a despawned entity (recycled-id guard)", () => {
      const dead = asEntity(99);
      const { api, emit } = startedCtx({}, []);

      api.select(dead);
      expect(api.selected()).toEqual([]);
      expect(emit).not.toHaveBeenCalled();
    });

    it("a redundant select of the already-sole entity does not re-emit", () => {
      const e1 = asEntity(1);
      const { api, emit } = startedCtx({}, [e1]);

      api.select(e1);
      expect(emit).toHaveBeenCalledTimes(1);

      api.select(e1); // no set change
      expect(emit).toHaveBeenCalledTimes(1);
    });

    it("emits editor-selection:changed with the new selected snapshot", () => {
      const e1 = asEntity(1);
      const { api, emit } = startedCtx({}, [e1]);

      api.select(e1);
      expect(emit).toHaveBeenCalledWith("editor-selection:changed", { selected: [e1] });
    });
  });

  describe("toggle", () => {
    it("flips membership single-select (on then off)", () => {
      const e1 = asEntity(1);
      const { api } = startedCtx({}, [e1]);

      api.toggle(e1);
      expect(api.isSelected(e1)).toBe(true);

      api.toggle(e1);
      expect(api.isSelected(e1)).toBe(false);
      expect(api.selected()).toEqual([]);
    });

    it("multiSelect toggle adds/removes without disturbing other members", () => {
      const e1 = asEntity(1);
      const e2 = asEntity(2);
      const { api } = startedCtx({ multiSelect: true }, [e1, e2]);

      api.select(e1);
      api.toggle(e2);
      expect(new Set(api.selected())).toEqual(new Set([e1, e2]));

      api.toggle(e2);
      expect(api.selected()).toEqual([e1]);
    });

    it("ignores a despawned entity", () => {
      const dead = asEntity(42);
      const { api, emit } = startedCtx();

      api.toggle(dead);
      expect(api.selected()).toEqual([]);
      expect(emit).not.toHaveBeenCalled();
    });
  });

  describe("clear", () => {
    it("empties the selection and emits exactly once with an empty snapshot", () => {
      const e1 = asEntity(1);
      const { api, emit } = startedCtx({}, [e1]);

      api.select(e1);
      emit.mockClear();

      api.clear();
      expect(api.selected()).toEqual([]);
      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith("editor-selection:changed", { selected: [] });
    });

    it("is a no-op (no emit) when the selection is already empty", () => {
      const { api, emit } = startedCtx();
      api.clear();
      expect(emit).not.toHaveBeenCalled();
    });
  });

  describe("selected() / isSelected()", () => {
    it("selected() returns a fresh array — mutating the result does not touch state", () => {
      const e1 = asEntity(1);
      const { api } = startedCtx({}, [e1]);
      api.select(e1);

      const snapshot = api.selected() as Entity[];
      snapshot.push(asEntity(2));

      expect(api.selected()).toEqual([e1]);
    });

    it("prunes a despawned entity from selected() and isSelected()", () => {
      const e1 = asEntity(1);
      const { api, alive } = startedCtx({}, [e1]);
      api.select(e1);

      alive.delete(e1); // simulate an external despawn the plugin did not observe

      expect(api.selected()).toEqual([]);
      expect(api.isSelected(e1)).toBe(false);
    });

    it("isSelected reflects current membership for a live entity", () => {
      const e1 = asEntity(1);
      const e2 = asEntity(2);
      const { api } = startedCtx({}, [e1, e2]);
      api.select(e1);

      expect(api.isSelected(e1)).toBe(true);
      expect(api.isSelected(e2)).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// selectInRect — world-space AABB hit-test over liveEntities()
// ─────────────────────────────────────────────────────────────────────────────

/** A view stub carrying only what the world-space AABB test reads: position + local bounds. */
type FakeView = {
  position: { x: number; y: number };
  getLocalBounds: () => { x: number; y: number; width: number; height: number };
};

/** A 10×10 view whose top-left local corner sits on its position. */
const makeView = (x: number, y: number, size = 10): FakeView => ({
  position: { x, y },
  getLocalBounds: () => ({ x: 0, y: 0, width: size, height: size })
});

/**
 * A STARTED ctx with a world whose `liveEntities()` reports every scripted view's entity
 * (so the `isAlive` prune is exercised independently of the live list) and a renderer stub
 * resolving each entity to its scripted view.
 */
const startedRectCtx = (
  over: Partial<Config> = {},
  viewsByEntity: ReadonlyMap<Entity, FakeView> = new Map()
) => {
  const config = makeConfig(over);
  const state = createState({ global: {}, config });
  const alive = new Set(viewsByEntity.keys());

  const world = {
    isAlive: (e: Entity) => alive.has(e),
    liveEntities: () => [...viewsByEntity.keys()]
  } as unknown as World;

  const renderer = {
    getEntityView: (e: Entity) => viewsByEntity.get(e) as unknown as Container | undefined,
    getView: () => undefined,
    getStage: () => undefined
  } as unknown as RendererApi;

  state.world = world;
  state.renderer = renderer;
  state.started = true;

  const log = makeLog();
  const emit = vi.fn();
  const ctx: EditorSelectionApiContext = { config, state, log, emit };
  return { api: createApi(ctx), ctx, state, log, emit, alive };
};

describe("editor-selection — api — selectInRect", () => {
  it("selects exactly the entities whose world bounds intersect the rect", () => {
    const inside = asEntity(1);
    const outside = asEntity(2);
    const { api } = startedRectCtx(
      {},
      new Map([
        [inside, makeView(5, 5)],
        [outside, makeView(500, 500)]
      ])
    );

    api.selectInRect({ x: 0, y: 0, width: 20, height: 20 });
    expect(api.selected()).toEqual([inside]);
  });

  it("counts an edge-touching view as intersecting", () => {
    const touching = asEntity(1);
    const { api } = startedRectCtx({}, new Map([[touching, makeView(20, 0)]]));

    api.selectInRect({ x: 0, y: 0, width: 20, height: 20 }); // rect right edge == view left edge
    expect(api.selected()).toEqual([touching]);
  });

  it("prunes a despawned entity that is still in liveEntities()", () => {
    const live = asEntity(1);
    const dead = asEntity(2);
    const { api, alive } = startedRectCtx(
      {},
      new Map([
        [live, makeView(0, 0)],
        [dead, makeView(1, 1)]
      ])
    );
    alive.delete(dead);

    api.selectInRect({ x: 0, y: 0, width: 50, height: 50 });
    expect(api.selected()).toEqual([live]);
  });

  it("REPLACES the selection when multiSelect is off", () => {
    const previous = asEntity(1);
    const hit = asEntity(2);
    const { api } = startedRectCtx(
      {},
      new Map([
        [previous, makeView(500, 500)],
        [hit, makeView(0, 0)]
      ])
    );
    api.select(previous);

    api.selectInRect({ x: 0, y: 0, width: 20, height: 20 });
    expect(api.selected()).toEqual([hit]); // the out-of-rect prior member is dropped
  });

  it("UNIONS into the current selection when multiSelect is on", () => {
    const previous = asEntity(1);
    const hit = asEntity(2);
    const { api } = startedRectCtx(
      { multiSelect: true },
      new Map([
        [previous, makeView(500, 500)],
        [hit, makeView(0, 0)]
      ])
    );
    api.select(previous);

    api.selectInRect({ x: 0, y: 0, width: 20, height: 20 });
    expect(new Set(api.selected())).toEqual(new Set([previous, hit]));
  });

  it("emits editor-selection:changed exactly once for a real change", () => {
    const hit = asEntity(1);
    const { api, emit } = startedRectCtx({}, new Map([[hit, makeView(0, 0)]]));

    api.selectInRect({ x: 0, y: 0, width: 20, height: 20 });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("editor-selection:changed", { selected: [hit] });
  });

  it("emits nothing when the rect selects the already-selected set", () => {
    const hit = asEntity(1);
    const { api, emit } = startedRectCtx({}, new Map([[hit, makeView(0, 0)]]));
    api.selectInRect({ x: 0, y: 0, width: 20, height: 20 });
    emit.mockClear();

    api.selectInRect({ x: 0, y: 0, width: 20, height: 20 }); // same result → no set change
    expect(emit).not.toHaveBeenCalled();
  });

  it("emits nothing when an empty rect meets an empty selection", () => {
    const { api, emit } = startedRectCtx({}, new Map([[asEntity(1), makeView(500, 500)]]));

    api.selectInRect({ x: 0, y: 0, width: 20, height: 20 });
    expect(api.selected()).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
  });

  it("an empty replace-rect over a prior selection is a real change and emits once", () => {
    const previous = asEntity(1);
    const { api, emit } = startedRectCtx({}, new Map([[previous, makeView(500, 500)]]));
    api.select(previous);
    emit.mockClear();

    api.selectInRect({ x: 0, y: 0, width: 20, height: 20 });
    expect(api.selected()).toEqual([]);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("editor-selection:changed", { selected: [] });
  });

  it("is a guarded no-op (warns, no emit) before start", () => {
    const { api, log, emit } = unstartedCtx();

    api.selectInRect({ x: 0, y: 0, width: 20, height: 20 });
    expect(emit).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalled();
  });

  it("is inert headless (no captured renderer/world handles)", () => {
    const config = makeConfig();
    const state = createState({ global: {}, config });
    state.started = true;
    const log = makeLog();
    const emit = vi.fn();
    const api = createApi({ config, state, log, emit });

    expect(() => api.selectInRect({ x: 0, y: 0, width: 20, height: 20 })).not.toThrow();
    expect(emit).not.toHaveBeenCalled();
  });
});

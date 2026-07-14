/**
 * @file editor-selection plugin — API surface unit tests.
 *
 * Exercises `app["editor-selection"]` via `createApi` with a minimal mock ctx
 * (`{ config, state, log, emit }`, `emit` a spy) and a stub `world` exposing only
 * `isAlive`. Covers the pure selection-set model — `select` (single-select REPLACES;
 * `multiSelect: true` ADDS), `toggle` (flips membership), `clear` (empties) — the
 * "emit only on real change" gate, `selected()`/`isSelected()` reading + pruning
 * despawned entities, and the before-start guard (mutators + `pickAt` + `selected()`
 * no-op; `isSelected` is a pure reader that works before start). `enable`/`disable`/
 * `pickAt`'s Pixi-facing behaviour is covered in `pick.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";
import type { Entity, World } from "../../../ecs/types";
import { createApi, type EditorSelectionApiContext } from "../../api";
import { createState } from "../../state";
import type { Config } from "../../types";

const asEntity = (n: number): Entity => n as Entity;

const makeConfig = (over: Partial<Config> = {}): Config => ({
  pickLayer: "world",
  multiSelect: false,
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

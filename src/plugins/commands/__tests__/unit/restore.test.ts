/**
 * @file commands plugin — restore() unit tests.
 *
 * `restore` is the non-undoable bulk reseed: it clears every editor-owned
 * entity, respawns from the given list re-binding each saved EditorId,
 * advances `nextId` past the highest restored id, and emits the coarse
 * `commands:restored` milestone.
 */
import { describe, expect, it, vi } from "vitest";
import type { CommandsApiContext } from "../../api";
import { createApi } from "../../api";
import { createState } from "../../state";
import type { Config, RestoreEntity } from "../../types";
import { asEditorId, makeLog, makeMockWorld } from "../mock-world";

const defaultConfig: Config = { maxIdWarn: 100_000 };

/** Build a fresh commands api + ctx wired to a fake world seeded with named components. */
const makeApi = (components: readonly string[] = ["Position"]) => {
  const config = { ...defaultConfig };
  const state = createState({ global: {}, config });
  const { world, alive, store } = makeMockWorld(components);
  const log = makeLog();
  const emit = vi.fn();
  const ctx: CommandsApiContext = {
    config,
    state,
    log,
    require: vi.fn(() => world),
    emit
  };
  return { api: createApi(ctx), ctx, world, alive, store, log, emit };
};

describe("commands api — restore", () => {
  it("despawns every prior editor-owned entity", () => {
    const { api, world } = makeApi();
    api.applyRaw({ kind: "spawn", components: {} });
    api.applyRaw({ kind: "spawn", components: {} });
    expect(api.count()).toBe(2);

    api.restore([], "reload");

    expect(world.despawn).toHaveBeenCalledTimes(2);
    expect(api.count()).toBe(0);
  });

  it("respawns from the list, re-binding each saved EditorId", () => {
    const { api } = makeApi(["Position"]);

    const entities: readonly RestoreEntity[] = [
      { id: asEditorId(5), components: { Position: { x: 1, y: 1 } } },
      { id: asEditorId(9), components: { Position: { x: 2, y: 2 } } }
    ];

    api.restore(entities, "reload");

    expect(api.count()).toBe(2);
    expect(api.resolve(asEditorId(5))).toBeDefined();
    expect(api.resolve(asEditorId(9))).toBeDefined();
  });

  it("sets nextId to one past the highest restored id, so a subsequent spawn does not collide", () => {
    const { api } = makeApi(["Position"]);

    api.restore([{ id: asEditorId(5), components: {} }], "reload");
    const spawned = api.applyRaw({ kind: "spawn", components: {} });

    expect(spawned.ok && spawned.id).toBe(6);
  });

  it("emits commands:restored with the given source", () => {
    const { api, emit } = makeApi();

    api.restore([], "reload");
    expect(emit).toHaveBeenCalledWith("commands:restored", { source: "reload" });

    api.restore([], "exit-play");
    expect(emit).toHaveBeenCalledWith("commands:restored", { source: "exit-play" });
  });

  it("skips a component name that no longer resolves, logging a warning (not a throw)", () => {
    const { api, log } = makeApi(["Position"]);

    expect(() => {
      api.restore([{ id: asEditorId(1), components: { NoSuchComponent: { x: 1 } } }], "reload");
    }).not.toThrow();

    expect(log.warn).toHaveBeenCalledOnce();
    expect(api.resolve(asEditorId(1))).toBeDefined(); // entity still spawned, just missing that component
  });

  it("is non-undoable — it returns void, not a CommandResult", () => {
    const { api } = makeApi();

    const result = api.restore([], "reload");

    expect(result).toBeUndefined();
  });
});

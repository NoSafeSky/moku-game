/**
 * @file serialization plugin — export()/import() unit tests.
 */
import { describe, expect, it, vi } from "vitest";
import type { Migration } from "../../../storage/types";
import { createApi } from "../../api";
import type { SceneDocument } from "../../types";
import { asEditorId, asEntity, makeCommandsMock, makeCtx, makeWorldMock } from "../mocks";

/** A v2 migration that clears all entities — proves the import path upgrades before restore. */
const clearEntities: Migration = snapshot => ({ ...snapshot, entities: [] });

describe("serialization — export()", () => {
  it("returns JSON.stringify(serialize())", () => {
    const { ctx } = makeCtx({ state: { currentName: "level1" } });
    const api = createApi(ctx);

    expect(api.export()).toBe(JSON.stringify(api.serialize()));
  });
});

describe("serialization — import()", () => {
  it("import(export()) round-trips through deserialize — restore reached, serialization:loaded emitted", () => {
    const entity = asEntity(1);
    const world = makeWorldMock({
      liveEntities: vi.fn(() => [entity]),
      componentsOf: vi.fn(() => [{ name: "Position", value: { x: 1, y: 1 } }])
    });
    const commands = makeCommandsMock({ editorIdOf: vi.fn(() => asEditorId(1)) });
    const { ctx, emit } = makeCtx({ world, commands, state: { currentName: "level1" } });
    const api = createApi(ctx);

    const json = api.export();
    api.import(json);

    expect(commands.restore).toHaveBeenCalledWith(
      [{ id: asEditorId(1), components: { Position: { x: 1, y: 1 } } }],
      "reload"
    );
    expect(emit).toHaveBeenCalledWith("serialization:loaded", { name: "level1", entityCount: 1 });
  });

  it("logs a warning and makes no world change on malformed JSON", () => {
    const { ctx, commands, log } = makeCtx();
    const api = createApi(ctx);

    api.import("{not valid json");

    expect(commands.restore).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it("logs a warning and makes no world change on a shape-invalid object (missing entities array)", () => {
    const { ctx, commands, log } = makeCtx();
    const api = createApi(ctx);

    api.import(JSON.stringify({ version: 1, name: "oops" }));

    expect(commands.restore).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it("migrates an imported document below config.version before restore", () => {
    const { ctx, commands } = makeCtx({ config: { version: 2, migrations: { 2: clearEntities } } });
    const api = createApi(ctx);
    const stale: SceneDocument = { version: 1, name: "level1", entities: [] };

    api.import(JSON.stringify(stale));

    expect(commands.restore).toHaveBeenCalledWith([], "reload");
    expect(ctx.state.currentVersion).toBe(2);
  });
});

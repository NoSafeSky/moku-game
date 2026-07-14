/**
 * @file serialization plugin — save()/load()/list() unit tests.
 */
import { describe, expect, it } from "vitest";

import { createApi } from "../../api";
import type { SceneDocument } from "../../types";
import { asEditorId, makeCtx, makeStorageMock } from "../mocks";

describe("serialization — save()", () => {
  it("writes under storageKeyPrefix + name and returns storage.set's boolean", () => {
    const { ctx, storage } = makeCtx();
    const api = createApi(ctx);

    const ok = api.save("level1");

    expect(ok).toBe(true);
    expect(storage.set).toHaveBeenCalledWith(
      "scene:level1",
      expect.objectContaining({ name: "level1" })
    );
    expect(ctx.state.currentName).toBe("level1");
  });

  it("propagates a false from storage.set without throwing, and does not update currentName", () => {
    const storage = makeStorageMock();
    storage.set.mockReturnValue(false);
    const { ctx } = makeCtx({ storage });
    const api = createApi(ctx);

    expect(() => api.save("level1")).not.toThrow();
    expect(api.save("level1")).toBe(false);
    expect(ctx.state.currentName).toBeUndefined();
  });
});

describe("serialization — load()", () => {
  it("reads + deserializes, reaching commands.restore, and returns true", () => {
    const doc: SceneDocument = {
      version: 1,
      name: "level1",
      entities: [{ id: asEditorId(1), components: {} }]
    };
    const store = new Map<string, unknown>([["scene:level1", doc]]);
    const storage = makeStorageMock(store);
    const { ctx, commands } = makeCtx({ storage });
    const api = createApi(ctx);

    const ok = api.load("level1");

    expect(ok).toBe(true);
    expect(commands.restore).toHaveBeenCalledWith(doc.entities, "reload");
  });

  it("returns false for a missing key and makes no world change / no emit", () => {
    const { ctx, commands, emit } = makeCtx();
    const api = createApi(ctx);

    expect(api.load("missing")).toBe(false);
    expect(commands.restore).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
});

describe("serialization — list()", () => {
  it("returns saved names with storageKeyPrefix stripped, excluding unrelated storage keys", () => {
    const store = new Map<string, unknown>([
      ["scene:level1", {}],
      ["scene:level2", {}],
      ["prefs:volume", {}]
    ]);
    const storage = makeStorageMock(store);
    const { ctx } = makeCtx({ storage });
    const api = createApi(ctx);

    expect(api.list()).toEqual(["level1", "level2"]);
  });

  it("returns [] when nothing is saved under the prefix", () => {
    const { ctx } = makeCtx();

    expect(createApi(ctx).list()).toEqual([]);
  });
});

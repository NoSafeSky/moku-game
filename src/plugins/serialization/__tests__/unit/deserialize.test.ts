/**
 * @file serialization plugin — deserialize() unit tests.
 */
import { describe, expect, it, vi } from "vitest";

import { createApi } from "../../api";
import type { SceneDocument } from "../../types";
import {
  asEditorId,
  asEntity,
  makeCommandsMock,
  makeCtx,
  makeReflectionMock,
  makeWorldMock
} from "../mocks";

const doc: SceneDocument = {
  version: 1,
  name: "level1",
  entities: [
    { id: asEditorId(1), components: { Position: { x: 1, y: 1 } } },
    { id: asEditorId(2), components: { Position: { x: 2, y: 2 } } }
  ]
};

describe("serialization — deserialize()", () => {
  it("routes through ONE commands.restore(doc.entities, 'reload') and emits serialization:loaded", () => {
    const { ctx, commands, emit } = makeCtx();
    const api = createApi(ctx);

    api.deserialize(doc);

    expect(commands.restore).toHaveBeenCalledTimes(1);
    expect(commands.restore).toHaveBeenCalledWith(doc.entities, "reload");
    expect(emit).toHaveBeenCalledWith("serialization:loaded", { name: "level1", entityCount: 2 });
  });

  it("deserialize(serialize()) round-trips the same captured entity set through restore", () => {
    const entity = asEntity(1);
    const world = makeWorldMock({
      liveEntities: vi.fn(() => [entity]),
      componentsOf: vi.fn(() => [{ name: "Position", value: { x: 5, y: 5 } }])
    });
    const commands = makeCommandsMock({ editorIdOf: vi.fn(() => asEditorId(7)) });
    const { ctx } = makeCtx({ world, commands });
    const api = createApi(ctx);

    const captured = api.serialize();
    api.deserialize(captured);

    expect(commands.restore).toHaveBeenCalledWith(captured.entities, "reload");
  });

  it("aborts atomically on the first rejected component — no restore, no emit, a warn is logged", () => {
    const reflection = makeReflectionMock((name, partial) =>
      name === "Position" && partial.x === 2
        ? { ok: false, errors: [{ key: "x", message: "bad value" }] }
        : { ok: true }
    );
    const { ctx, commands, emit, log } = makeCtx({ reflection });
    const api = createApi(ctx);

    api.deserialize(doc);

    expect(commands.restore).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it("validates every component BEFORE restore (guard order)", () => {
    const order: string[] = [];
    const reflection = makeReflectionMock(name => {
      order.push(`validate:${name}`);
      return { ok: true };
    });
    const commands = makeCommandsMock({
      restore: vi.fn(() => {
        order.push("restore");
      })
    });
    const { ctx } = makeCtx({ reflection, commands });
    const api = createApi(ctx);

    api.deserialize(doc);

    expect(order.at(-1)).toBe("restore");
    expect(order.filter(step => step.startsWith("validate:"))).toHaveLength(2);
  });

  it("updates state.currentName/currentVersion after a successful restore", () => {
    const { ctx } = makeCtx();
    const api = createApi(ctx);

    api.deserialize(doc);

    expect(ctx.state.currentName).toBe("level1");
    expect(ctx.state.currentVersion).toBe(1);
  });

  it("leaves state.currentName/currentVersion untouched when validation rejects", () => {
    const reflection = makeReflectionMock(() => ({
      ok: false,
      errors: [{ key: "x", message: "bad" }]
    }));
    const { ctx } = makeCtx({ reflection, state: { currentName: "previous", currentVersion: 1 } });
    const api = createApi(ctx);

    api.deserialize(doc);

    expect(ctx.state.currentName).toBe("previous");
  });
});

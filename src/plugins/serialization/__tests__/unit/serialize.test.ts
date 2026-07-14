/**
 * @file serialization plugin — serialize() unit tests.
 */
import { describe, expect, it, vi } from "vitest";

import { createApi } from "../../api";
import { asEditorId, asEntity, makeCommandsMock, makeCtx, makeWorldMock } from "../mocks";

describe("serialization — serialize()", () => {
  it("emits only editor-owned entities, keyed by EditorId, carrying componentsOf's named components", () => {
    const [entityA, entityB, entityC] = [asEntity(1), asEntity(2), asEntity(3)];
    const world = makeWorldMock({
      liveEntities: vi.fn(() => [entityA, entityB, entityC]),
      componentsOf: vi.fn((entity: unknown) => {
        if (entity === entityA) return [{ name: "Position", value: { x: 1, y: 1 } }];
        if (entity === entityB) return [{ name: "Position", value: { x: 2, y: 2 } }];
        return [{ name: "Position", value: { x: 9, y: 9 } }];
      })
    });
    const commands = makeCommandsMock({
      editorIdOf: vi.fn((entity: unknown) => {
        if (entity === entityA) return asEditorId(10);
        if (entity === entityB) return asEditorId(20);
        return undefined; // entityC is not editor-owned — skipped
      })
    });
    const { ctx } = makeCtx({ world, commands });
    const api = createApi(ctx);

    const doc = api.serialize();

    expect(doc.entities).toHaveLength(2);
    expect(doc.entities.map(entity => entity.id)).toEqual([asEditorId(10), asEditorId(20)]);
    expect(doc.entities[0]?.components).toEqual({ Position: { x: 1, y: 1 } });
    expect(doc.entities[1]?.components).toEqual({ Position: { x: 2, y: 2 } });
  });

  it("shallow-copies component values — mutating the returned document does not mutate the world", () => {
    const entity = asEntity(1);
    const live = { x: 1, y: 1 };
    const world = makeWorldMock({
      liveEntities: vi.fn(() => [entity]),
      componentsOf: vi.fn(() => [{ name: "Position", value: live }])
    });
    const commands = makeCommandsMock({ editorIdOf: vi.fn(() => asEditorId(1)) });
    const { ctx } = makeCtx({ world, commands });
    const api = createApi(ctx);

    const doc = api.serialize();
    const captured = doc.entities[0]?.components.Position as { x: number };
    captured.x = 999;

    expect(live.x).toBe(1);
  });

  it("stamps version from config.version and name from state.currentName, falling back to 'untitled'", () => {
    const { ctx: named } = makeCtx({ config: { version: 2 }, state: { currentName: "level1" } });
    expect(createApi(named).serialize()).toMatchObject({ version: 2, name: "level1" });

    const { ctx: unnamed } = makeCtx({ config: { version: 2 } });
    expect(createApi(unnamed).serialize()).toMatchObject({ version: 2, name: "untitled" });
  });

  it("returns an empty entities array when no live entity is editor-owned", () => {
    const world = makeWorldMock({ liveEntities: vi.fn(() => [asEntity(1)]) });
    const commands = makeCommandsMock({ editorIdOf: vi.fn(() => undefined) });
    const { ctx } = makeCtx({ world, commands });

    expect(createApi(ctx).serialize().entities).toEqual([]);
  });
});

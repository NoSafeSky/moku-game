/**
 * @file editor-bridge plugin — buildEntities unit tests.
 */
import { describe, expect, it, vi } from "vitest";

import type { Entity } from "../../../ecs/types";
import type { FieldDescriptor } from "../../../reflection/types";
import type { CommandsFacet, ReflectionFacet, WorldFacet } from "../../snapshot";
import { buildEntities } from "../../snapshot";
import { asEditorId, asEntity } from "../mock-deps";

const TRANSFORM_FIELDS: FieldDescriptor[] = [
  { kind: "number", key: "x", label: "X" },
  { kind: "number", key: "y", label: "Y" }
];

describe("buildEntities", () => {
  it("returns [] for an empty world", () => {
    const world: WorldFacet = { liveEntities: () => [], componentsOf: () => [] };
    const commands: CommandsFacet = { editorIdOf: () => undefined };
    const reflection: ReflectionFacet = { describe: () => [] };

    expect(buildEntities(world, commands, reflection)).toEqual([]);
  });

  it("maps each editor-owned live entity to an EntitySnapshot carrying its id + component fields", () => {
    const entityA = asEntity(1);
    const entityB = asEntity(2);
    const world: WorldFacet = {
      liveEntities: () => [entityA, entityB],
      componentsOf: vi.fn((entity: Entity) =>
        entity === entityA
          ? [{ name: "Transform", value: { x: 1, y: 2 } }]
          : [{ name: "Transform", value: { x: 3, y: 4 } }]
      )
    };
    const commands: CommandsFacet = {
      editorIdOf: (entity: Entity) => (entity === entityA ? asEditorId(10) : asEditorId(20))
    };
    const reflection: ReflectionFacet = { describe: vi.fn(() => TRANSFORM_FIELDS) };

    const entities = buildEntities(world, commands, reflection);

    expect(entities).toHaveLength(2);
    expect(entities[0]).toEqual({
      id: asEditorId(10),
      components: [{ name: "Transform", value: { x: 1, y: 2 }, fields: TRANSFORM_FIELDS }]
    });
    expect(entities[1]?.id).toBe(asEditorId(20));
    expect(reflection.describe).toHaveBeenCalledWith("Transform");
  });

  it("skips a live entity whose editorIdOf is undefined (not editor-owned)", () => {
    const owned = asEntity(1);
    const unowned = asEntity(2);
    const world: WorldFacet = {
      liveEntities: () => [owned, unowned],
      componentsOf: () => [{ name: "Transform", value: { x: 0, y: 0 } }]
    };
    const commands: CommandsFacet = {
      editorIdOf: (entity: Entity) => (entity === owned ? asEditorId(1) : undefined)
    };
    const reflection: ReflectionFacet = { describe: () => [] };

    const entities = buildEntities(world, commands, reflection);

    expect(entities).toHaveLength(1);
    expect(entities[0]?.id).toBe(asEditorId(1));
  });

  it("deep-freezes the result array, each EntitySnapshot, and each ComponentSnapshot", () => {
    const entity = asEntity(1);
    const world: WorldFacet = {
      liveEntities: () => [entity],
      componentsOf: () => [{ name: "Transform", value: { x: 0, y: 0 } }]
    };
    const commands: CommandsFacet = { editorIdOf: () => asEditorId(1) };
    const reflection: ReflectionFacet = { describe: () => [] };

    const entities = buildEntities(world, commands, reflection);
    const [entity0] = entities;
    if (entity0 === undefined) throw new Error("expected one entity");
    const [component0] = entity0.components;
    if (component0 === undefined) throw new Error("expected one component");

    expect(Object.isFrozen(entities)).toBe(true);
    expect(Object.isFrozen(entity0)).toBe(true);
    expect(Object.isFrozen(entity0.components)).toBe(true);
    expect(Object.isFrozen(component0)).toBe(true);

    expect(() => {
      // @ts-expect-error -- id is readonly on a frozen EntitySnapshot
      entity0.id = asEditorId(999);
    }).toThrow();
  });
});

/**
 * @file editor-bridge plugin — buildEntities unit tests.
 */
import { describe, expect, it, type Mock, vi } from "vitest";

import type { Component, Entity } from "../../../ecs/types";
import type { NodeValue } from "../../../hierarchy/types";
import type { FieldDescriptor } from "../../../reflection/types";
import type { CommandsFacet, HierarchyFacet, ReflectionFacet, WorldFacet } from "../../snapshot";
import { buildEntities } from "../../snapshot";
import { asEditorId, asEntity } from "../mock-deps";

const TRANSFORM_FIELDS: FieldDescriptor[] = [
  { kind: "number", key: "x", label: "X" },
  { kind: "number", key: "y", label: "Y" }
];

/** A stable, never-invoked fake `Node` component token for `WorldFacet.get`/`HierarchyFacet.Node`. */
const NODE_TOKEN = vi.fn() as unknown as Component<NodeValue>;

/** A `HierarchyFacet` stub: no children, unless overridden. */
const makeHierarchy = (childrenOf: HierarchyFacet["childrenOf"] = () => []): HierarchyFacet => ({
  Node: NODE_TOKEN,
  childrenOf
});

describe("buildEntities", () => {
  it("returns [] for an empty world", () => {
    const world: WorldFacet = {
      liveEntities: () => [],
      componentsOf: () => [],
      get: () => undefined
    };
    const commands: CommandsFacet = { editorIdOf: () => undefined };
    const reflection: ReflectionFacet = { describe: () => [] };
    const hierarchy = makeHierarchy();

    expect(buildEntities(world, commands, reflection, hierarchy)).toEqual([]);
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
      ),
      get: () => undefined
    };
    const commands: CommandsFacet = {
      editorIdOf: (entity: Entity) => (entity === entityA ? asEditorId(10) : asEditorId(20))
    };
    const reflection: ReflectionFacet = { describe: vi.fn(() => TRANSFORM_FIELDS) };
    const hierarchy = makeHierarchy();

    const entities = buildEntities(world, commands, reflection, hierarchy);

    expect(entities).toHaveLength(2);
    expect(entities[0]).toEqual({
      id: asEditorId(10),
      name: "",
      enabled: true,
      parent: undefined,
      children: [],
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
      componentsOf: () => [{ name: "Transform", value: { x: 0, y: 0 } }],
      get: () => undefined
    };
    const commands: CommandsFacet = {
      editorIdOf: (entity: Entity) => (entity === owned ? asEditorId(1) : undefined)
    };
    const reflection: ReflectionFacet = { describe: () => [] };
    const hierarchy = makeHierarchy();

    const entities = buildEntities(world, commands, reflection, hierarchy);

    expect(entities).toHaveLength(1);
    expect(entities[0]?.id).toBe(asEditorId(1));
  });

  it("lifts a live Node's name/enabled/parent to the entity level, derives children, and FILTERS Node out of components", () => {
    const entity = asEntity(1);
    const id = asEditorId(1);
    const parentId = asEditorId(2);
    const childId = asEditorId(3);
    const node: NodeValue = { parent: parentId, order: 0, name: "Grunt", enabled: false };
    // Typed as the bare (any-based) `Mock` — `WorldFacet.get` is generic over `T`, and a concrete
    // `NodeValue`-returning stub is not itself assignable to `<T>(...) => T | undefined`.
    const get: Mock = vi.fn(() => node);
    const world: WorldFacet = {
      liveEntities: () => [entity],
      componentsOf: () => [
        { name: "Node", value: node },
        { name: "Transform", value: { x: 0, y: 0 } }
      ],
      get
    };
    const commands: CommandsFacet = { editorIdOf: () => id };
    const reflection: ReflectionFacet = { describe: () => [] };
    const hierarchy = makeHierarchy(nodeId => (nodeId === id ? [childId] : []));

    const [entitySnapshot] = buildEntities(world, commands, reflection, hierarchy);
    if (entitySnapshot === undefined) throw new Error("expected one entity");

    expect(entitySnapshot.name).toBe("Grunt");
    expect(entitySnapshot.enabled).toBe(false);
    expect(entitySnapshot.parent).toBe(parentId);
    expect(entitySnapshot.children).toEqual([childId]);
    expect(entitySnapshot.components).toEqual([
      { name: "Transform", value: { x: 0, y: 0 }, fields: [] }
    ]);
    expect(entitySnapshot.components.some(component => component.name === "Node")).toBe(false);
  });

  it("heals a missing Node to name:''/enabled:true/parent:undefined (root) and children:[]", () => {
    const entity = asEntity(1);
    const world: WorldFacet = {
      liveEntities: () => [entity],
      componentsOf: () => [{ name: "Transform", value: { x: 0, y: 0 } }],
      get: () => undefined
    };
    const commands: CommandsFacet = { editorIdOf: () => asEditorId(1) };
    const reflection: ReflectionFacet = { describe: () => [] };
    const hierarchy = makeHierarchy();

    const [entitySnapshot] = buildEntities(world, commands, reflection, hierarchy);
    if (entitySnapshot === undefined) throw new Error("expected one entity");

    expect(entitySnapshot.name).toBe("");
    expect(entitySnapshot.enabled).toBe(true);
    expect(entitySnapshot.parent).toBeUndefined();
    expect(entitySnapshot.children).toEqual([]);
  });

  it("deep-freezes the result array, each EntitySnapshot, its children array, and each ComponentSnapshot", () => {
    const entity = asEntity(1);
    const world: WorldFacet = {
      liveEntities: () => [entity],
      componentsOf: () => [{ name: "Transform", value: { x: 0, y: 0 } }],
      get: () => undefined
    };
    const commands: CommandsFacet = { editorIdOf: () => asEditorId(1) };
    const reflection: ReflectionFacet = { describe: () => [] };
    const hierarchy = makeHierarchy();

    const entities = buildEntities(world, commands, reflection, hierarchy);
    const [entity0] = entities;
    if (entity0 === undefined) throw new Error("expected one entity");
    const [component0] = entity0.components;
    if (component0 === undefined) throw new Error("expected one component");

    expect(Object.isFrozen(entities)).toBe(true);
    expect(Object.isFrozen(entity0)).toBe(true);
    expect(Object.isFrozen(entity0.children)).toBe(true);
    expect(Object.isFrozen(entity0.components)).toBe(true);
    expect(Object.isFrozen(component0)).toBe(true);

    expect(() => {
      // @ts-expect-error -- id is readonly on a frozen EntitySnapshot
      entity0.id = asEditorId(999);
    }).toThrow();
  });
});

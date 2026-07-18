/**
 * @file editor-bridge plugin — pure snapshot builder (over the deps' facets).
 *
 * `buildEntities` walks the live world into a deeply-frozen, id-stable, FLAT, HIERARCHICAL entity
 * tree. It is pure over four structural facets (`WorldFacet`/`CommandsFacet`/`ReflectionFacet`/
 * `HierarchyFacet` — the exact methods it calls), so a unit test can drive it with four stub
 * objects and no kernel/app — mirrors `camera`'s `transform.ts` / `reflection`'s `infer.ts` (a
 * pure module, thin `api.ts`).
 */
import type { EditorId } from "../commands/types";
import type { Component, Entity } from "../ecs/types";
import type { NodeValue } from "../hierarchy/types";
import type { FieldDescriptor } from "../reflection/types";
import type { ComponentSnapshot, EntitySnapshot } from "./types";

/** The subset of the ecs `World` API `buildEntities` reads: live entities, their named components, and a typed read (for the `Node` lift). */
export type WorldFacet = {
  /** Snapshot array of every currently-live entity handle. */
  liveEntities(): readonly Entity[];
  /** The named components currently on an entity, paired with their live values. */
  componentsOf(entity: Entity): ReadonlyArray<{ name: string; value: unknown }>;
  /** Typed component read (undefined if absent/dead) — used to lift the entity's `Node` without an `as`. */
  get<T extends object>(entity: Entity, component: Component<T>): T | undefined;
};

/** The subset of the `commands` API `buildEntities` reads: the Entity → EditorId translation. */
export type CommandsFacet = {
  /** The stable EditorId for a live Entity, or `undefined` if it is not editor-owned. */
  editorIdOf(entity: Entity): EditorId | undefined;
};

/** The subset of the `reflection` API `buildEntities` reads: field descriptors per component name. */
export type ReflectionFacet = {
  /** The field descriptors for a named component. */
  describe(componentName: string): FieldDescriptor[];
};

/** The subset of the `hierarchy` API `buildEntities` reads: the typed `Node` token + ordered children. */
export type HierarchyFacet = {
  /** The Node component token, for the typed `world.get(entity, hierarchy.Node)` lift. */
  readonly Node: Component<NodeValue>;
  /** The entity's direct children as EditorIds, ordered by `Node.order`. */
  childrenOf(id: EditorId): readonly EditorId[];
};

/**
 * Builds one frozen `ComponentSnapshot` for a named component/value pair, attaching its field
 * descriptors from the `reflection` facet.
 *
 * @param name - The registered component name.
 * @param value - The live component value at snapshot time.
 * @param reflection - The reflection facet (`describe`).
 * @returns A frozen `ComponentSnapshot`.
 * @example
 * ```ts
 * buildComponent("Transform", { x: 0, y: 0 }, reflection);
 * ```
 */
const buildComponent = (
  name: string,
  value: unknown,
  reflection: ReflectionFacet
): ComponentSnapshot => Object.freeze({ name, value, fields: reflection.describe(name) });

/**
 * Walks the live world into a deeply-frozen, id-stable, FLAT entity tree. Skips any live entity
 * whose `commands.editorIdOf` is `undefined` (not editor-owned). For each remaining entity, reads
 * its typed `Node` (`world.get(entity, hierarchy.Node)`, no `as`) to lift `name`/`enabled`/`parent`
 * to the entity level — self-healing a missing `Node` (a legacy v1 scene) to `name: ""`,
 * `enabled: true`, root — derives ordered `children` via `hierarchy.childrenOf`, and FILTERS the
 * `Node`-named component out of `components` (it surfaces at the entity level instead). Pure over
 * the passed facets so unit tests drive it with stub `world`/`commands`/`reflection`/`hierarchy` —
 * no kernel, no app.
 *
 * @param world - The ecs world facet (`liveEntities`/`componentsOf`/`get`).
 * @param commands - The commands facet (`editorIdOf`).
 * @param reflection - The reflection facet (`describe`).
 * @param hierarchy - The hierarchy facet (`Node`/`childrenOf`).
 * @returns A frozen array of frozen `EntitySnapshot`s.
 * @example
 * ```ts
 * buildEntities(world, commands, reflection, hierarchy); // readonly EntitySnapshot[]
 * ```
 */
export const buildEntities = (
  world: WorldFacet,
  commands: CommandsFacet,
  reflection: ReflectionFacet,
  hierarchy: HierarchyFacet
): readonly EntitySnapshot[] => {
  const entities: EntitySnapshot[] = [];

  for (const entity of world.liveEntities()) {
    const id = commands.editorIdOf(entity);
    if (id === undefined) continue;

    const node = world.get(entity, hierarchy.Node);
    const children = Object.freeze([...hierarchy.childrenOf(id)]);
    const components = world
      .componentsOf(entity)
      .filter(component => component.name !== "Node")
      .map(component => buildComponent(component.name, component.value, reflection));

    entities.push(
      Object.freeze({
        id,
        name: node?.name ?? "",
        enabled: node?.enabled ?? true,
        parent: node?.parent,
        children,
        components: Object.freeze(components)
      })
    );
  }

  return Object.freeze(entities);
};

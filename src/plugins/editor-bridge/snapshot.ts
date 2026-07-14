/**
 * @file editor-bridge plugin — pure snapshot builder (over the deps' facets).
 *
 * `buildEntities` walks the live world into a deeply-frozen, id-stable entity tree. It is pure
 * over three structural facets (`WorldFacet`/`CommandsFacet`/`ReflectionFacet` — the exact
 * methods it calls), so a unit test can drive it with three stub objects and no kernel/app —
 * mirrors `camera`'s `transform.ts` / `reflection`'s `infer.ts` (a pure module, thin `api.ts`).
 */
import type { EditorId } from "../commands/types";
import type { Entity } from "../ecs/types";
import type { FieldDescriptor } from "../reflection/types";
import type { ComponentSnapshot, EntitySnapshot } from "./types";

/** The subset of the ecs `World` API `buildEntities` reads: live entities + their named components. */
export type WorldFacet = {
  /** Snapshot array of every currently-live entity handle. */
  liveEntities(): readonly Entity[];
  /** The named components currently on an entity, paired with their live values. */
  componentsOf(entity: Entity): ReadonlyArray<{ name: string; value: unknown }>;
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
 * Walks the live world into a deeply-frozen, id-stable entity tree. Skips any live entity whose
 * `commands.editorIdOf` is `undefined` (not editor-owned). Pure over the passed facets so unit
 * tests drive it with stub `world`/`commands`/`reflection` — no kernel, no app.
 *
 * @param world - The ecs world facet (`liveEntities`/`componentsOf`).
 * @param commands - The commands facet (`editorIdOf`).
 * @param reflection - The reflection facet (`describe`).
 * @returns A frozen array of frozen `EntitySnapshot`s.
 * @example
 * ```ts
 * buildEntities(world, commands, reflection); // readonly EntitySnapshot[]
 * ```
 */
export const buildEntities = (
  world: WorldFacet,
  commands: CommandsFacet,
  reflection: ReflectionFacet
): readonly EntitySnapshot[] => {
  const entities: EntitySnapshot[] = [];

  for (const entity of world.liveEntities()) {
    const id = commands.editorIdOf(entity);
    if (id === undefined) continue;

    const components = world
      .componentsOf(entity)
      .map(({ name, value }) => buildComponent(name, value, reflection));

    entities.push(Object.freeze({ id, components: Object.freeze(components) }));
  }

  return Object.freeze(entities);
};

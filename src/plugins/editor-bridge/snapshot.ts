/**
 * @file editor-bridge plugin — pure snapshot builder skeleton (over the deps' facets).
 */
import type { EntitySnapshot } from "./types";

/**
 * Walks the live world into a deeply-frozen, id-stable entity tree. Pure over the passed facets so
 * unit tests drive it with stub `world`/`commands`/`reflection` — no kernel, no app.
 *
 * @param _world - The ecs world facet (`liveEntities`/`componentsOf`).
 * @param _commands - The commands facet (`editorIdOf`).
 * @param _reflection - The reflection facet (`describe`).
 * @throws {Error} Always in the skeleton — implemented during build.
 * @example
 * ```ts
 * buildEntities(world, commands, reflection);
 * ```
 */
export function buildEntities(
  _world: unknown,
  _commands: unknown,
  _reflection: unknown
): readonly EntitySnapshot[] {
  throw new Error("not implemented");
}

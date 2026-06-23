/**
 * @file ecs plugin — World construction (entity table, archetypes, command buffer, systems).
 */
import type { Config, World } from "./types";

/**
 * Constructs the ECS World with the given configuration.
 *
 * @param _config - Resolved ecs configuration.
 * @example
 * ```ts
 * const world = createWorld({ initialCapacity: 1024, maxStructuralOpsWarn: 0 });
 * ```
 */
export function createWorld(_config: Config): World {
  throw new Error("not implemented");
}

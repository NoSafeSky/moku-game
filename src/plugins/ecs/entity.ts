/**
 * @file ecs plugin — generational entity table (index allocation + recycling).
 */
import type { Config } from "./types";

/**
 * Creates the generational entity table that allocates, recycles, and validates entity handles.
 *
 * @param _config - Resolved ecs configuration (initial capacity).
 * @example
 * ```ts
 * const table = createEntityTable({ initialCapacity: 1024, maxStructuralOpsWarn: 0 });
 * ```
 */
export function createEntityTable(_config: Config): unknown {
  throw new Error("not implemented");
}

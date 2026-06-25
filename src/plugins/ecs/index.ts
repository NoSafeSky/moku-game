/**
 * ECS plugin — Complex tier.
 *
 * ECS data/runtime core: generational entities, archetype object-SoA storage,
 * typed queries, deferred command buffer, world.tick(dt), and world resources
 * (typed singletons). Resource ops are immediate — never command-buffered.
 * Emits no events.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { createApi } from "./api";
import { createState } from "./state";
import type { Config } from "./types";

const defaultConfig: Config = { initialCapacity: 1024, maxStructuralOpsWarn: 0 };

/**
 * ECS plugin — the data/runtime core (no dependencies).
 *
 * Provides generational entities, archetype object-SoA component storage, typed queries,
 * a deferred command buffer, `world.tick(dt)`, and a typed world resource registry
 * (`defineResource`/`setResource`/`getResource`/`resource`/`hasResource`/`removeResource`).
 * Resource ops apply immediately — never command-buffered. Emits no events.
 */
export const ecsPlugin = createPlugin("ecs", {
  config: defaultConfig,
  createState,
  api: createApi
});

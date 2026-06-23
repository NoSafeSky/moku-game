/**
 * @file ecs plugin — World construction (entity table, archetypes, command buffer, systems).
 *
 * `createWorld` wires together the entity table, archetype store, sparse storage,
 * command buffer, and system registry into the single `World` facade. All structural
 * mutations route through the command buffer when `iterating` is true (during
 * `updateEach` / system callbacks); otherwise they apply immediately.
 */
import { createArchetypeStore } from "./archetype";
import { createCommandBuffer } from "./command-buffer";
import { createEntityTable } from "./entity";
import type {
  Component,
  ComponentInit,
  Config,
  Entity,
  Query,
  Stage,
  StorageStrategy,
  System,
  World
} from "./types";

// ─── Internal component registry entry ───────────────────────

/** Registry entry holding metadata for a single registered component. */
interface ComponentEntry {
  readonly id: number;
  readonly create: () => unknown;
  readonly storage: StorageStrategy;
}

// ─── Stage execution order ────────────────────────────────────

const STAGE_ORDER: readonly Stage[] = ["input", "update", "physics", "sync", "render"];

// ─── Component token factory ──────────────────────────────────
//
// `Component<T>` in types.ts now has a call signature — `(value: T) => ComponentInit`.
// At runtime the token is a function that also carries `__id` as a non-enumerable
// property. The `__value` field is a phantom type field (never set at runtime).

/**
 * Create a typed component token (a callable function with a hidden `__id`).
 *
 * @param id - The numeric component ID assigned by the registry.
 * @returns A `Component<T>` token that produces `ComponentInit` instances when called.
 * @example
 * ```ts
 * const token = makeToken<{ x: number }>(0);
 * const init = token({ x: 5 });
 * ```
 */
const makeToken = <T>(id: number): Component<T> => {
  // Build a function with the call signature of Component<T>
  /**
   * Produce a ComponentInit pairing this token with the given value.
   *
   * @param value - The component value to pair with this token.
   * @returns A ComponentInit object containing the component token and value.
   * @example
   * ```ts
   * const init = token({ x: 5 });
   * ```
   */
  const token = (value: T): ComponentInit => ({
    component: token as unknown as Component<never>,
    value
  });
  // Attach the runtime-readable __id (used by world internals to look up the component)
  Object.defineProperty(token, "__id", { value: id, writable: false, enumerable: false });
  // __value is type-level only; no runtime property needed
  return token as unknown as Component<T>;
};

/**
 * Constructs the ECS World with the given configuration.
 *
 * @param config - Resolved ecs configuration.
 * @returns The fully wired World facade.
 * @example
 * ```ts
 * const world = createWorld({ initialCapacity: 1024, maxStructuralOpsWarn: 0 });
 * const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
 * const entity = world.spawn(Position({ x: 10, y: 5 }));
 * ```
 */
export function createWorld(config: Config): World {
  const entityTable = createEntityTable(config.initialCapacity);
  const archetypeStore = createArchetypeStore();
  const commandBuffer = createCommandBuffer();

  /** Sparse storage: componentId → Map<entity, value> */
  const sparseStorage = new Map<number, Map<Entity, unknown>>();

  /** Component registry: componentId → entry */
  const componentRegistry = new Map<number, ComponentEntry>();
  let nextComponentId = 0;

  /** Systems registry: stage → System[] */
  const systems = new Map<Stage, System[]>();
  for (const stage of STAGE_ORDER) {
    systems.set(stage, []);
  }

  /** True while inside updateEach or a system callback — routes ops to command buffer. */
  let iterating = false;

  // ─── Flush target ─────────────────────────────────────────

  /**
   * Insert a pre-reserved entity into the appropriate archetypes and sparse maps.
   *
   * @param entity - The pre-reserved entity handle.
   * @param componentIds - Component IDs to associate with the entity.
   * @param values - Parallel component values for each ID.
   * @example
   * ```ts
   * insertSpawned(entity, [posId], [{ x: 0, y: 0 }]);
   * ```
   */
  const insertSpawned = (entity: Entity, componentIds: number[], values: unknown[]): void => {
    const archetypeIds: number[] = [];
    const archetypeValues: unknown[] = [];

    for (const [index, componentId_] of componentIds.entries()) {
      const componentId = componentId_!;
      const entry = componentRegistry.get(componentId);
      if (entry?.storage === "sparse") {
        let sparseMap = sparseStorage.get(componentId);
        if (!sparseMap) {
          sparseMap = new Map();
          sparseStorage.set(componentId, sparseMap);
        }
        sparseMap.set(entity, values[index]);
      } else {
        archetypeIds.push(componentId);
        archetypeValues.push(values[index]);
      }
    }

    if (archetypeIds.length > 0) {
      archetypeStore.insert(entity, archetypeIds, archetypeValues);
    }
  };

  /**
   * Complete a despawn by removing the entity from all archetypes, sparse maps, and the entity table.
   *
   * @param entity - The entity handle to fully remove.
   * @example
   * ```ts
   * completeDespawn(entity);
   * ```
   */
  const completeDespawn = (entity: Entity): void => {
    archetypeStore.remove(entity);
    for (const sparseMap of sparseStorage.values()) {
      sparseMap.delete(entity);
    }
    entityTable.free(entity);
  };

  /**
   * Apply an add-component operation immediately, routing to sparse or archetype storage.
   *
   * @param entity - The entity to add the component to.
   * @param componentId - The numeric component ID to add.
   * @param value - The component value to store.
   * @example
   * ```ts
   * applyAdd(entity, velId, { dx: 1, dy: 0 });
   * ```
   */
  const applyAdd = (entity: Entity, componentId: number, value: unknown): void => {
    const entry = componentRegistry.get(componentId);
    if (entry?.storage === "sparse") {
      let sparseMap = sparseStorage.get(componentId);
      if (!sparseMap) {
        sparseMap = new Map();
        sparseStorage.set(componentId, sparseMap);
      }
      sparseMap.set(entity, value);
    } else {
      archetypeStore.addComponent(entity, componentId, value);
    }
  };

  /**
   * Apply a remove-component operation immediately, routing to sparse or archetype storage.
   *
   * @param entity - The entity to remove the component from.
   * @param componentId - The numeric component ID to remove.
   * @example
   * ```ts
   * applyRemove(entity, velId);
   * ```
   */
  const applyRemove = (entity: Entity, componentId: number): void => {
    const entry = componentRegistry.get(componentId);
    if (entry?.storage === "sparse") {
      sparseStorage.get(componentId)?.delete(entity);
    } else {
      archetypeStore.removeComponent(entity, componentId);
    }
  };

  const flushTarget = { insertSpawned, completeDespawn, applyAdd, applyRemove };

  // ─── Flush the command buffer ─────────────────────────────

  /**
   * Flush all pending command buffer operations if any are queued.
   *
   * @example
   * ```ts
   * flushBuffer();
   * ```
   */
  const flushBuffer = (): void => {
    if (commandBuffer.hasPending) {
      commandBuffer.flush(flushTarget);
    }
  };

  // ─── Spawn helper ─────────────────────────────────────────

  /**
   * Core spawn implementation: reserve an entity and either insert immediately or enqueue.
   *
   * @param parts - Array of ComponentInit pairs produced by calling component tokens.
   * @returns The newly reserved entity handle.
   * @example
   * ```ts
   * const entity = doSpawn([Position({ x: 0, y: 0 })]);
   * ```
   */
  const doSpawn = (parts: ComponentInit[]): Entity => {
    const entity = entityTable.reserve();
    const componentIds: number[] = [];
    const values: unknown[] = [];
    for (const part of parts) {
      // Guard: bare token (function) passed instead of ComponentInit — skip.
      if (typeof part !== "object" || part === null) continue;
      componentIds.push(part.component.__id);
      values.push(part.value);
    }
    if (iterating) {
      commandBuffer.enqueueSpawn(entity, componentIds, values);
    } else {
      insertSpawned(entity, componentIds, values);
    }
    return entity;
  };

  // ─── Query builder ────────────────────────────────────────

  /**
   * Build a Query object for the given sorted component IDs.
   *
   * @param ids - Array of component IDs that the query must match.
   * @returns A Query facade with updateEach, count, first, and Symbol.iterator.
   * @example
   * ```ts
   * const query = buildQuery([posId, velId]);
   * ```
   */
  const buildQuery = (ids: number[]): Query<object[]> => ({
    /**
     * Iterate all matching entities, calling `cb` with their component values.
     *
     * @param cb - Callback receiving the tuple of component values and the entity.
     * @example
     * ```ts
     * query.updateEach(([pos], entity) => { pos.x += 1; });
     * ```
     */
    updateEach(cb: (values: object[], entity: Entity) => void): void {
      const wasIterating = iterating;
      iterating = true;
      try {
        for (const row of archetypeStore.iterateArchetype(ids)) {
          if (!entityTable.isAlive(row.entity)) continue;
          const values = ids.map(id => row.getValue(id) as object);
          cb(values, row.entity);
        }
      } finally {
        iterating = wasIterating;
        if (!iterating) flushBuffer();
      }
    },

    /**
     * Count all live entities that match this query's component signature.
     *
     * @returns The number of matching live entities.
     * @example
     * ```ts
     * query.count(); // 3
     * ```
     */
    count(): number {
      let total = 0;
      for (const row of archetypeStore.iterateArchetype(ids)) {
        if (entityTable.isAlive(row.entity)) total++;
      }
      return total;
    },

    /**
     * Return the first live entity that matches this query, or undefined if none.
     *
     * @returns The first matching Entity handle, or undefined.
     * @example
     * ```ts
     * const player = query.first();
     * ```
     */
    first(): Entity | undefined {
      for (const row of archetypeStore.iterateArchetype(ids)) {
        if (entityTable.isAlive(row.entity)) return row.entity;
      }
      return undefined;
    },

    /**
     * Make the query iterable so it can be used in `for...of` loops.
     *
     * @returns An Iterator that yields each live matching Entity.
     * @example
     * ```ts
     * for (const entity of query) { world.despawn(entity); }
     * ```
     */
    [Symbol.iterator](): Iterator<Entity> {
      const iter = archetypeStore.iterateArchetype(ids)[Symbol.iterator]();
      return {
        /**
         * Advance to the next live entity in the query result set.
         *
         * @returns An IteratorResult with the next live Entity or `done: true`.
         * @example
         * ```ts
         * const result = iter.next();
         * ```
         */
        next(): IteratorResult<Entity> {
          let result = iter.next();
          while (!result.done) {
            if (entityTable.isAlive(result.value.entity)) {
              return { done: false, value: result.value.entity };
            }
            result = iter.next();
          }
          return { done: true, value: undefined as unknown as Entity };
        }
      };
    }
  });

  // ─── World methods ────────────────────────────────────────
  //
  // Built without a type annotation so TypeScript doesn't fight the variadic
  // `query` implementation against the per-arity overloads. Cast to `World` below.

  const world = {
    /**
     * Register a new component type and return its typed token.
     *
     * @param create - Factory that produces the default value for this component.
     * @param opts - Optional storage options.
     * @param opts.storage - Storage strategy: `"archetype"` (default) or `"sparse"`.
     * @returns A `Component<T>` token used to spawn and query entities.
     * @example
     * ```ts
     * const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
     * ```
     */
    defineComponent<T extends object>(
      create: () => T,
      opts?: { storage?: StorageStrategy }
    ): Component<T> {
      const id = nextComponentId++;
      const storage = opts?.storage ?? "archetype";
      componentRegistry.set(id, { id, create, storage });
      if (storage === "sparse") sparseStorage.set(id, new Map());
      return makeToken<T>(id);
    },

    /**
     * Register a zero-value tag component and return its typed token.
     *
     * @param opts - Optional storage options.
     * @param opts.storage - Storage strategy: `"sparse"` (default) or `"archetype"`.
     * @returns A `Component<Record<never, never>>` token for the tag.
     * @example
     * ```ts
     * const Alive = world.defineTag();
     * world.spawn(Alive({}));
     * ```
     */
    defineTag(opts?: { storage?: StorageStrategy }): Component<Record<never, never>> {
      const id = nextComponentId++;
      const storage = opts?.storage ?? "sparse";
      /**
       * Produce the default (empty) tag value.
       *
       * @returns A fresh empty tag value.
       * @example
       * ```ts
       * const value = createTag();
       * ```
       */
      const createTag = (): Record<never, never> => ({});
      componentRegistry.set(id, { id, create: createTag, storage });
      if (storage === "sparse") sparseStorage.set(id, new Map());
      return makeToken<Record<never, never>>(id);
    },

    /**
     * Spawn a new entity with the given component initializers.
     *
     * @param parts - One or more `ComponentInit` values produced by calling component tokens.
     * @returns The newly created entity handle.
     * @example
     * ```ts
     * const entity = world.spawn(Position({ x: 0, y: 0 }));
     * ```
     */
    spawn(...parts: ComponentInit[]): Entity {
      return doSpawn(parts);
    },

    /**
     * Despawn an entity, removing it from all storage and freeing its slot.
     *
     * @param entity - The entity handle to despawn.
     * @example
     * ```ts
     * world.despawn(entity);
     * ```
     */
    despawn(entity: Entity): void {
      if (!entityTable.isAlive(entity)) return;
      if (iterating) {
        commandBuffer.enqueueDespawn(entity);
      } else {
        completeDespawn(entity);
      }
    },

    /**
     * Return true if the entity handle refers to a currently live entity.
     *
     * @param entity - The entity handle to check.
     * @returns Whether the entity is alive (not yet despawned).
     * @example
     * ```ts
     * world.isAlive(entity); // true
     * ```
     */
    isAlive(entity: Entity): boolean {
      return entityTable.isAlive(entity);
    },

    /**
     * Add a component to an existing entity, merging the given value with the component default.
     *
     * @param entity - The entity to add the component to.
     * @param component - The component token identifying which component to add.
     * @param value - Optional partial value to merge with the component default.
     * @example
     * ```ts
     * world.add(entity, Velocity, { dx: 5, dy: 0 });
     * ```
     */
    add<T extends object>(entity: Entity, component: Component<T>, value?: Partial<T>): void {
      if (!entityTable.isAlive(entity)) return;
      const id = component.__id;
      const entry = componentRegistry.get(id);
      const defaultValue = entry ? (entry.create() as T) : ({} as T);
      const merged = value ? { ...defaultValue, ...value } : defaultValue;
      if (iterating) {
        commandBuffer.enqueueAdd(entity, id, merged);
      } else {
        applyAdd(entity, id, merged);
      }
    },

    /**
     * Remove a component from an entity, migrating it to a smaller archetype.
     *
     * @param entity - The entity to remove the component from.
     * @param component - The component token identifying which component to remove.
     * @example
     * ```ts
     * world.remove(entity, Velocity);
     * ```
     */
    remove(entity: Entity, component: Component<never>): void {
      if (!entityTable.isAlive(entity)) return;
      const id = component.__id;
      if (iterating) {
        commandBuffer.enqueueRemove(entity, id);
      } else {
        applyRemove(entity, id);
      }
    },

    /**
     * Return true if the entity currently has the given component.
     *
     * @param entity - The entity to check.
     * @param component - The component token to look up.
     * @returns Whether the entity has this component in any storage.
     * @example
     * ```ts
     * world.has(entity, Velocity); // false
     * ```
     */
    has(entity: Entity, component: Component<never>): boolean {
      if (!entityTable.isAlive(entity)) return false;
      const id = component.__id;
      const entry = componentRegistry.get(id);
      if (entry?.storage === "sparse") {
        return sparseStorage.get(id)?.has(entity) ?? false;
      }
      return archetypeStore.has(entity, id);
    },

    /**
     * Read the current value of a component on an entity.
     *
     * @param entity - The entity to read from.
     * @param component - The component token identifying which component to read.
     * @returns The component value, or undefined if the entity lacks this component.
     * @example
     * ```ts
     * const pos = world.get(entity, Position); // { x: 0, y: 0 } | undefined
     * ```
     */
    get<T extends object>(entity: Entity, component: Component<T>): T | undefined {
      if (!entityTable.isAlive(entity)) return undefined;
      const id = component.__id;
      const entry = componentRegistry.get(id);
      if (entry?.storage === "sparse") {
        return sparseStorage.get(id)?.get(entity) as T | undefined;
      }
      return archetypeStore.get(entity, id) as T | undefined;
    },

    /**
     * Partially update a component value on an entity in-place.
     *
     * @param entity - The entity whose component should be updated.
     * @param component - The component token identifying which component to update.
     * @param value - Partial value to merge into the existing component data.
     * @example
     * ```ts
     * world.set(entity, Position, { x: 10 });
     * ```
     */
    set<T extends object>(entity: Entity, component: Component<T>, value: Partial<T>): void {
      if (!entityTable.isAlive(entity)) return;
      const id = component.__id;
      const entry = componentRegistry.get(id);
      if (entry?.storage === "sparse") {
        const sparseMap = sparseStorage.get(id);
        const current = sparseMap?.get(entity) as T | undefined;
        if (current !== undefined && sparseMap) {
          sparseMap.set(entity, { ...current, ...value });
        }
      } else {
        const current = archetypeStore.get(entity, id) as T | undefined;
        if (current !== undefined) Object.assign(current, value);
      }
    },

    // Variadic implementation that satisfies all per-arity overloads at runtime.
    // The cast to `World` below resolves the overload type mismatch at compile time.
    /**
     * Build a query for entities that have all of the given components.
     *
     * @param components - One or more component tokens that entities must possess.
     * @returns A Query facade for iterating, counting, or selecting matching entities.
     * @example
     * ```ts
     * world.query(Position, Velocity).updateEach(([pos, vel]) => { pos.x += vel.dx; });
     * ```
     */
    query(...components: Component<object>[]): Query<object[]> {
      return buildQuery(components.map(c => c.__id));
    },

    /**
     * Register a system to run during the given stage, returning an unsubscribe function.
     *
     * @param stage - The execution stage (`"input"`, `"update"`, `"physics"`, `"sync"`, `"render"`).
     * @param system - The system function to register.
     * @returns A function that removes the system from the stage when called.
     * @example
     * ```ts
     * const remove = world.addSystem("update", (w, dt) => { w.query(Position).updateEach(([p]) => { p.x += dt; }); });
     * ```
     */
    addSystem(stage: Stage, system: System): () => void {
      const stageSystems = systems.get(stage);
      if (!stageSystems) return () => {};
      stageSystems.push(system);
      return (): void => {
        const index = stageSystems.indexOf(system);
        if (index !== -1) stageSystems.splice(index, 1);
      };
    },

    /**
     * Advance the world by one tick, running all systems in stage order and flushing deferred ops.
     *
     * @param dt - Delta time in seconds since the last tick.
     * @example
     * ```ts
     * world.tick(1 / 60);
     * ```
     */
    tick(dt: number): void {
      for (const stage of STAGE_ORDER) {
        const stageSystems = [...(systems.get(stage) ?? [])];
        for (const system of stageSystems) {
          iterating = true;
          try {
            system(world as unknown as World, dt);
          } finally {
            iterating = false;
          }
          flushBuffer();
        }
        // Flush at each stage boundary even if no systems ran
        flushBuffer();
      }
    }
  };

  // Cast to public World type. The variadic `query` implementation satisfies all
  // per-arity overloads at runtime; the cast resolves the structural mismatch that
  // TypeScript's overload narrowing would otherwise reject.
  return world as unknown as World;
}

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
  Resource,
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
  /** Optional introspection name (from defineComponent/defineTag `opts.name`); undefined when anonymous. */
  readonly name: string | undefined;
  /**
   * The original callable token returned to the caller of defineComponent/defineTag.
   * Stored here (value-type-erased to `Component<Record<string, unknown>>`) so
   * `componentByName` can return the exact same reference without a per-call cast.
   * The single widening cast lives at the registry-store boundary in defineComponent/
   * defineTag — `Component<T>` is invariant in its value param, so a uniform registry
   * type necessarily erases the concrete `T`.
   */
  readonly token: Component<Record<string, unknown>>;
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

  // ─── Resource registry ────────────────────────────────────
  //
  // Resource ops are IMMEDIATE — they only touch these maps, never archetype
  // layout, so they cannot corrupt an in-flight query. The `iterating` flag
  // is deliberately ignored by all resource methods.

  /** Currently-set resource values, keyed by Resource.__key. */
  const resourceValues = new Map<string, unknown>();
  /** Default factories registered by defineResource(create), for lazy init. */
  const resourceFactories = new Map<string, () => unknown>();
  /** Monotonic counter used to mint stable "res:N" keys via defineResource. */
  let nextResourceId = 0;

  // ─── Editor cycle: change epoch + stage gate ──────────────
  //
  // `changeEpoch` is a monotonically non-decreasing counter bumped once per data
  // write (the four structural appliers + `set` + each `updateEach` pass). It is
  // unconditional (never gated on an editor flag) so `tick` stays monomorphic —
  // the one accepted pay-for-what-you-use exception. The editor polls it to refresh
  // an inspector with NO per-frame emit.

  /** Monotonically non-decreasing change counter — bumped once per data write. */
  let changeEpoch = 0;
  /** The active-stage list for `tick`, or `undefined` (the sentinel + default = all stages). */
  let activeStagesValue: readonly Stage[] | undefined;
  /** Membership set derived from `activeStagesValue` for O(1) gate checks in `tick`; `undefined` = all. */
  let activeStagesSet: Set<Stage> | undefined;

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
    changeEpoch++; // structural write: entity created
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
    changeEpoch++; // structural write: entity destroyed
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
    changeEpoch++; // structural write: component added
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
    changeEpoch++; // structural write: component removed
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
      changeEpoch++; // updateEach is the value-mutation path (a ref mutation is invisible to `set`)
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
     * @param opts - Optional storage + introspection options.
     * @param opts.storage - Storage strategy: `"archetype"` (default) or `"sparse"`.
     * @param opts.name - Optional name making the component discoverable via `componentNames`/`componentsOf`.
     * @returns A `Component<T>` token used to spawn and query entities.
     * @example
     * ```ts
     * const Position = world.defineComponent(() => ({ x: 0, y: 0 }), { name: "Position" });
     * ```
     */
    defineComponent<T extends object>(
      create: () => T,
      opts?: { storage?: StorageStrategy; name?: string }
    ): Component<T> {
      const id = nextComponentId++;
      const storage = opts?.storage ?? "archetype";
      const token = makeToken<T>(id);
      // Widen to the type-erased registry token here (the store boundary) — Component<T>
      // is invariant in its value param, so the uniform registry necessarily erases T.
      componentRegistry.set(id, {
        id,
        create,
        storage,
        name: opts?.name,
        token: token as unknown as Component<Record<string, unknown>>
      });
      if (storage === "sparse") sparseStorage.set(id, new Map());
      return token;
    },

    /**
     * Register a zero-value tag component and return its typed token.
     *
     * @param opts - Optional storage + introspection options.
     * @param opts.storage - Storage strategy: `"sparse"` (default) or `"archetype"`.
     * @param opts.name - Optional name making the tag discoverable via `componentNames`/`componentsOf`.
     * @returns A `Component<Record<never, never>>` token for the tag.
     * @example
     * ```ts
     * const Alive = world.defineTag();
     * world.spawn(Alive({}));
     * ```
     */
    defineTag(opts?: {
      storage?: StorageStrategy;
      name?: string;
    }): Component<Record<never, never>> {
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
      const token = makeToken<Record<never, never>>(id);
      // Widen to the type-erased registry token here (the store boundary) — see defineComponent.
      componentRegistry.set(id, {
        id,
        create: createTag,
        storage,
        name: opts?.name,
        token: token as unknown as Component<Record<string, unknown>>
      });
      if (storage === "sparse") sparseStorage.set(id, new Map());
      return token;
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
          changeEpoch++; // value write
        }
      } else {
        const current = archetypeStore.get(entity, id) as T | undefined;
        if (current !== undefined) {
          Object.assign(current, value);
          changeEpoch++; // value write
        }
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
      // systems is pre-populated for every Stage; create lazily as a defensive fallback
      // so an unknown stage registers a real array rather than silently dropping the system.
      let stageSystems = systems.get(stage);
      if (!stageSystems) {
        stageSystems = [];
        systems.set(stage, stageSystems);
      }
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
        // Stage gate: `=== undefined` fast path so non-editor games pay nothing. A gated-off
        // stage skips its systems but still flushes the command buffer (structural correctness).
        if (activeStagesSet !== undefined && !activeStagesSet.has(stage)) {
          flushBuffer();
          continue;
        }
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
    },

    // ─── Editor cycle: change epoch + stage gate ─────────────

    /**
     * Read the monotonically non-decreasing change epoch (bumped once per data write).
     * Editor tooling polls this to refresh an inspector without a per-frame kernel `emit`.
     *
     * @returns The current change epoch (starts at 0; only increases).
     * @example
     * ```ts
     * const before = world.changeEpoch();
     * world.set(entity, Position, { x: 1 });
     * world.changeEpoch() > before; // true
     * ```
     */
    changeEpoch(): number {
      return changeEpoch;
    },

    /**
     * Gate which stages `world.tick` runs. `undefined` (default + sentinel) runs all stages.
     * A gated-off stage is skipped but its command-buffer flush still runs.
     *
     * @param stages - The stages to keep active, or `undefined` for all stages.
     * @example
     * ```ts
     * world.setActiveStages(["input", "sync", "render"]); // edit mode
     * ```
     */
    setActiveStages(stages: readonly Stage[] | undefined): void {
      activeStagesValue = stages;
      activeStagesSet = stages === undefined ? undefined : new Set(stages);
    },

    /**
     * The stages currently active for `world.tick`, or `undefined` when all stages run.
     *
     * @returns The active-stage list, or `undefined` (all stages / default).
     * @example
     * ```ts
     * world.activeStages(); // undefined by default
     * ```
     */
    activeStages(): readonly Stage[] | undefined {
      return activeStagesValue;
    },

    // ─── Introspection (read-only — for tooling such as the mcp plugin) ───────

    /**
     * Return a snapshot array of every currently-live entity handle.
     *
     * @returns A read-only array of live entity handles (fresh copy; order follows slot index).
     * @example
     * ```ts
     * for (const e of world.liveEntities()) console.log(world.componentsOf(e));
     * ```
     */
    liveEntities(): readonly Entity[] {
      return entityTable.liveEntities();
    },

    /**
     * Return the number of currently-live entities (O(1) — maintained by the entity table).
     *
     * @returns The count of live entities.
     * @example
     * ```ts
     * const n = world.entityCount();
     * ```
     */
    entityCount(): number {
      return entityTable.liveCount();
    },

    /**
     * Return the names of all components defined with an `opts.name`, in registration order.
     * Anonymous components are not listed.
     *
     * @returns A read-only array of registered component names.
     * @example
     * ```ts
     * world.componentNames(); // ["Transform", "Velocity"]
     * ```
     */
    componentNames(): readonly string[] {
      const names: string[] = [];
      for (const entry of componentRegistry.values()) {
        if (entry.name !== undefined) names.push(entry.name);
      }
      return names;
    },

    /**
     * Return the named components currently on an entity, paired with their live values.
     * Anonymous components are omitted; a dead or unknown entity yields an empty array.
     *
     * @param entity - The entity to inspect.
     * @returns A read-only array of `{ name, value }` for each named component the entity has.
     * @example
     * ```ts
     * world.componentsOf(ball); // [{ name: "Transform", value: { x: 10, y: 5 } }]
     * ```
     */
    componentsOf(entity: Entity): ReadonlyArray<{ name: string; value: unknown }> {
      if (!entityTable.isAlive(entity)) return [];

      const result: Array<{ name: string; value: unknown }> = [];
      for (const entry of componentRegistry.values()) {
        if (entry.name === undefined) continue;

        // Probe the storage that matches this component's strategy.
        const present =
          entry.storage === "sparse"
            ? (sparseStorage.get(entry.id)?.has(entity) ?? false)
            : archetypeStore.has(entity, entry.id);
        if (!present) continue;

        const value =
          entry.storage === "sparse"
            ? sparseStorage.get(entry.id)?.get(entity)
            : archetypeStore.get(entity, entry.id);
        result.push({ name: entry.name, value });
      }
      return result;
    },

    /**
     * Resolve a component registered with `opts.name` to its callable component token.
     *
     * The token's value type is widened to `Record<string, unknown>` so callers can pass
     * partial values without per-component generics or inline casts. Use the returned token
     * with the existing `add` / `set` / `get` / `has` / `remove` methods.
     *
     * **Read-only** — mutates nothing.
     *
     * **Duplicate names:** if two components share the same `opts.name`, the first registered
     * is returned. Prefer unique names to avoid ambiguity.
     *
     * @param name - The `opts.name` value passed to `defineComponent` or `defineTag`.
     * @returns The matching component token widened to `Component<Record<string, unknown>>`,
     *   or `undefined` if no named component matches.
     * @example
     * ```ts
     * const token = world.componentByName("Position");
     * if (token) world.add(entity, token, { x: 5 });
     * ```
     */
    componentByName(name: string): Component<Record<string, unknown>> | undefined {
      // Linear scan; returns the FIRST entry matching `name` (duplicate names resolve to
      // the first registered). The stored token is already value-type-erased — no cast here.
      for (const entry of componentRegistry.values()) {
        if (entry.name === name) return entry.token;
      }
      return undefined;
    },

    // ─── Resources ───────────────────────────────────────────

    /**
     * Define a world resource and return its typed token.
     *
     * @param create - Optional factory called once on first read to produce the initial value.
     * @returns A `Resource<T>` token with a stable auto-generated key.
     * @example
     * ```ts
     * const Score = world.defineResource(() => ({ value: 0, combo: 1 }));
     * ```
     */
    defineResource<T>(create?: () => T): Resource<T> {
      const key = `res:${nextResourceId++}`;
      if (create !== undefined) {
        resourceFactories.set(key, create as () => unknown);
      }
      return { __key: key } as Resource<T>;
    },

    /**
     * Store or replace a resource value immediately (never command-buffered).
     *
     * @param resource - The resource token identifying which resource to set.
     * @param value - The value to store.
     * @example
     * ```ts
     * world.setResource(Score, { value: 100, combo: 3 });
     * ```
     */
    setResource<T>(resource: Resource<T>, value: T): void {
      resourceValues.set(resource.__key, value);
    },

    /**
     * Read a resource value, lazily initialising from the factory if unset.
     * Returns `undefined` if neither a value nor a factory exists.
     *
     * @param resource - The resource token identifying which resource to read.
     * @returns The resource value, or `undefined` if unset with no factory.
     * @example
     * ```ts
     * const score = world.getResource(Score);
     * ```
     */
    getResource<T>(resource: Resource<T>): T | undefined {
      const key = resource.__key;
      if (resourceValues.has(key)) {
        return resourceValues.get(key) as T;
      }
      const factory = resourceFactories.get(key);
      if (factory !== undefined) {
        const value = factory();
        resourceValues.set(key, value);
        return value as T;
      }
      return undefined;
    },

    /**
     * Read a resource value. Throws a clear, actionable error if unset with no factory.
     *
     * @param resource - The resource token identifying which resource to read.
     * @returns The resource value (never `undefined`).
     * @throws {Error} When the resource is unset and no factory exists.
     * @example
     * ```ts
     * const score = world.resource(Score);
     * ```
     */
    resource<T>(resource: Resource<T>): T {
      const key = resource.__key;
      if (resourceValues.has(key)) {
        return resourceValues.get(key) as T;
      }
      const factory = resourceFactories.get(key);
      if (factory !== undefined) {
        const value = factory();
        resourceValues.set(key, value);
        return value as T;
      }
      throw new Error(
        `[game] world.resource() — resource "${key}" is not set.\n` +
          `  Set it with world.setResource(token, value) or define it with world.defineResource(() => …). Framework resources (Assets, GameContext, Time) are wired at app.start().`
      );
    },

    /**
     * Return `true` if reading this resource would succeed — a value is set, OR a factory exists.
     *
     * @param resource - The resource token to check.
     * @returns `true` if `getResource` would return a non-`undefined` value.
     * @example
     * ```ts
     * world.hasResource(Score); // true
     * ```
     */
    hasResource<T>(resource: Resource<T>): boolean {
      const key = resource.__key;
      return resourceValues.has(key) || resourceFactories.has(key);
    },

    /**
     * Clear the stored value for this resource. A factory, if any, will re-initialise on next read.
     * Applies immediately — never command-buffered.
     *
     * @param resource - The resource token to clear.
     * @example
     * ```ts
     * world.removeResource(Score);
     * ```
     */
    removeResource<T>(resource: Resource<T>): void {
      resourceValues.delete(resource.__key);
    }
  };

  // Cast to public World type. The variadic `query` implementation satisfies all
  // per-arity overloads at runtime; the cast resolves the structural mismatch that
  // TypeScript's overload narrowing would otherwise reject.
  return world as unknown as World;
}

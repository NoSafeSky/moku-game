/**
 * @file ecs plugin — archetype object-SoA component storage.
 *
 * An Archetype groups entities that share exactly the same sorted set of component IDs.
 * Each archetype holds parallel columns: one `entities` column (the row→Entity mapping)
 * and one column per component. Despawning uses a swap-remove to keep columns dense.
 *
 * Sparse-stored components bypass archetypes entirely — they live in a per-component
 * `Map<Entity, value>` and are tracked in a separate sparse-storage registry.
 */
import type { Entity } from "./types";

// ─── Types ────────────────────────────────────────────────────

/** A single archetype: entities sharing the same component signature. */
interface Archetype {
  /** Sorted component-id set that defines this archetype. */
  readonly signature: readonly number[];
  /** Parallel row of entity handles. */
  readonly entities: Entity[];
  /** component-id → dense column of values, parallel to entities. */
  readonly columns: Map<number, unknown[]>;
}

/** Result entry yielded when iterating an archetype for a query. */
export interface ArchetypeRow {
  /** The entity at this row. */
  entity: Entity;
  /** Get the value for a component id at this row. */
  getValue(componentId: number): unknown;
}

/** The entity→location record: which archetype row an entity occupies. */
interface EntityLocation {
  archetype: Archetype;
  row: number;
}

/** Public API returned by createArchetypeStore. */
export interface ArchetypeStore {
  /**
   * Insert an entity into an archetype defined by the given component IDs and values.
   * Creates the archetype if it doesn't exist yet.
   *
   * @param entity - The entity to insert.
   * @param componentIds - Sorted array of component IDs.
   * @param values - Parallel array of component values.
   */
  insert(entity: Entity, componentIds: number[], values: unknown[]): void;

  /**
   * Remove an entity entirely from its archetype (swap-remove).
   *
   * @param entity - The entity to remove.
   */
  remove(entity: Entity): void;

  /**
   * Migrate an entity to a new archetype that adds one component.
   *
   * @param entity - The entity to migrate.
   * @param componentId - The component ID to add.
   * @param value - The component value.
   */
  addComponent(entity: Entity, componentId: number, value: unknown): void;

  /**
   * Migrate an entity to a new archetype that removes one component.
   *
   * @param entity - The entity to migrate.
   * @param componentId - The component ID to remove.
   */
  removeComponent(entity: Entity, componentId: number): void;

  /**
   * True if the entity has the given component (in archetype storage).
   *
   * @param entity - The entity to check.
   * @param componentId - The component ID to look up.
   * @returns Whether the entity has the component.
   */
  has(entity: Entity, componentId: number): boolean;

  /**
   * Read the archetype-stored value for a component; undefined if absent.
   *
   * @param entity - The entity to read from.
   * @param componentId - The component ID to look up.
   * @returns The component value, or undefined if absent.
   */
  get(entity: Entity, componentId: number): unknown;

  /**
   * Iterate all rows of an archetype that contains ALL the requested component IDs.
   * Yields every archetype that is a superset of the given signature.
   *
   * @param componentIds - The required component IDs (must all be present).
   * @returns Iterable of ArchetypeRow for each matching entity.
   */
  iterateArchetype(componentIds: number[]): Iterable<ArchetypeRow>;
}

// ─── Signature helpers ────────────────────────────────────────

/**
 * Build a stable string key from a sorted array of component IDs.
 *
 * @param ids - Sorted array of component IDs.
 * @returns A comma-joined string key unique to this component set.
 * @example
 * ```ts
 * makeSignatureKey([1, 2, 3]); // "1,2,3"
 * ```
 */
const makeSignatureKey = (ids: readonly number[]): string => ids.join(",");

/**
 * Return a new sorted array that is the union of `a` and the single value `b`.
 *
 * @param a - The existing sorted component-ID array.
 * @param b - The component ID to insert.
 * @returns A new sorted array containing all IDs from `a` plus `b`.
 * @example
 * ```ts
 * sortedUnion([1, 3], 2); // [1, 2, 3]
 * ```
 */
const sortedUnion = (a: readonly number[], b: number): number[] =>
  [...a, b].toSorted((x, y) => x - y);

/**
 * Return a new array containing all elements of `a` except the given component ID.
 *
 * @param a - The existing sorted component-ID array.
 * @param id - The component ID to remove.
 * @returns A new array with the specified ID omitted.
 * @example
 * ```ts
 * sortedWithout([1, 2, 3], 2); // [1, 3]
 * ```
 */
const sortedWithout = (a: readonly number[], id: number): number[] => a.filter(x => x !== id);

// ─── Implementation ───────────────────────────────────────────

/**
 * Creates the archetype store that groups entities by component signature for
 * cache-friendly iteration. Uses swap-remove for O(1) despawn.
 *
 * @returns The archetype store API.
 * @example
 * ```ts
 * const store = createArchetypeStore();
 * store.insert(entity, [posId], [{ x: 0, y: 0 }]);
 * store.get(entity, posId); // { x: 0, y: 0 }
 * ```
 */
export function createArchetypeStore(): ArchetypeStore {
  /** signature key → Archetype */
  const archetypes = new Map<string, Archetype>();
  /** entity → current location */
  const locations = new Map<Entity, EntityLocation>();

  /**
   * Return the existing archetype for the given sorted signature, or create it.
   *
   * @param sortedIds - Sorted array of component IDs defining the archetype signature.
   * @returns The existing or newly created Archetype.
   * @example
   * ```ts
   * const archetype = getOrCreateArchetype([1, 2]);
   * ```
   */
  const getOrCreateArchetype = (sortedIds: number[]): Archetype => {
    const key = makeSignatureKey(sortedIds);
    let archetype = archetypes.get(key);
    if (!archetype) {
      const columns = new Map<number, unknown[]>();
      for (const id of sortedIds) {
        columns.set(id, []);
      }
      archetype = { signature: sortedIds, entities: [], columns };
      archetypes.set(key, archetype);
    }
    return archetype;
  };

  /**
   * Swap-remove an entity from its current archetype and return its saved component values.
   *
   * @param _entity - Unused; kept for a positional call signature (the row is located via `location`).
   * @param location - The entity's current archetype and row index.
   * @returns A record mapping component IDs to the removed entity's saved values.
   * @example
   * ```ts
   * const saved = removeFromArchetype(entity, locations.get(entity)!);
   * ```
   */
  const removeFromArchetype = (
    _entity: Entity,
    location: EntityLocation
  ): Record<number, unknown> => {
    const { archetype, row } = location;
    const lastRow = archetype.entities.length - 1;
    const savedValues: Record<number, unknown> = {};

    for (const [componentId, column] of archetype.columns) {
      savedValues[componentId] = column[row];
    }

    if (row !== lastRow) {
      // Swap-remove: move the last entity into this row
      const lastEntity = archetype.entities[lastRow]!;
      archetype.entities[row] = lastEntity;
      for (const column of archetype.columns.values()) {
        column[row] = column[lastRow];
      }
      // Update the moved entity's location
      const movedLocation = locations.get(lastEntity);
      if (movedLocation) {
        movedLocation.row = row;
      }
    }

    archetype.entities.pop();
    for (const column of archetype.columns.values()) {
      column.pop();
    }

    return savedValues;
  };

  return {
    /**
     * Insert an entity into an archetype defined by the given component IDs and values.
     *
     * @param entity - The entity handle to insert.
     * @param componentIds - Array of component IDs (will be sorted internally).
     * @param values - Parallel array of component values matching componentIds.
     * @example
     * ```ts
     * store.insert(entity, [posId], [{ x: 0, y: 0 }]);
     * ```
     */
    insert(entity: Entity, componentIds: number[], values: unknown[]): void {
      const sorted = componentIds.toSorted((a, b) => a - b);
      const archetype = getOrCreateArchetype(sorted);
      const row = archetype.entities.length;
      archetype.entities.push(entity);
      for (const element of sorted) {
        archetype.columns.get(element!)!.push(values[componentIds.indexOf(element!)]!);
      }
      locations.set(entity, { archetype, row });
    },

    /**
     * Remove an entity entirely from its archetype using a swap-remove.
     *
     * @param entity - The entity handle to remove.
     * @example
     * ```ts
     * store.remove(entity);
     * ```
     */
    remove(entity: Entity): void {
      const location = locations.get(entity);
      if (!location) return;
      removeFromArchetype(entity, location);
      locations.delete(entity);
    },

    /**
     * Migrate an entity to a new archetype that adds one component.
     *
     * @param entity - The entity handle to migrate.
     * @param componentId - The component ID to add.
     * @param value - The initial value for the new component.
     * @example
     * ```ts
     * store.addComponent(entity, velId, { dx: 0, dy: 0 });
     * ```
     */
    addComponent(entity: Entity, componentId: number, value: unknown): void {
      const location = locations.get(entity);
      if (!location) {
        // Entity not yet in any archetype — insert into a single-component one
        this.insert(entity, [componentId], [value]);
        return;
      }
      const savedValues = removeFromArchetype(entity, location);
      locations.delete(entity);

      const newIds = sortedUnion(location.archetype.signature, componentId);
      const newArchetype = getOrCreateArchetype(newIds);
      const newRow = newArchetype.entities.length;
      newArchetype.entities.push(entity);
      for (const id of newIds) {
        const value_ = id === componentId ? value : savedValues[id];
        newArchetype.columns.get(id)!.push(value_);
      }
      locations.set(entity, { archetype: newArchetype, row: newRow });
    },

    /**
     * Migrate an entity to a new archetype that removes one component.
     *
     * @param entity - The entity handle to migrate.
     * @param componentId - The component ID to remove.
     * @example
     * ```ts
     * store.removeComponent(entity, velId);
     * ```
     */
    removeComponent(entity: Entity, componentId: number): void {
      const location = locations.get(entity);
      if (!location) return;
      if (!location.archetype.columns.has(componentId)) return;

      const savedValues = removeFromArchetype(entity, location);
      locations.delete(entity);

      const newIds = sortedWithout(location.archetype.signature, componentId);
      if (newIds.length === 0) {
        // Entity has no more archetype components — unregistered (may still have sparse)
        return;
      }
      const newArchetype = getOrCreateArchetype(newIds);
      const newRow = newArchetype.entities.length;
      newArchetype.entities.push(entity);
      for (const id of newIds) {
        newArchetype.columns.get(id)!.push(savedValues[id]);
      }
      locations.set(entity, { archetype: newArchetype, row: newRow });
    },

    /**
     * Return true if the entity has the given component in archetype storage.
     *
     * @param entity - The entity handle to check.
     * @param componentId - The component ID to look up.
     * @returns Whether the entity currently has the component in this archetype store.
     * @example
     * ```ts
     * store.has(entity, posId); // true or false
     * ```
     */
    has(entity: Entity, componentId: number): boolean {
      const location = locations.get(entity);
      if (!location) return false;
      return location.archetype.columns.has(componentId);
    },

    /**
     * Read the archetype-stored value for a component; returns undefined if absent.
     *
     * @param entity - The entity handle to read from.
     * @param componentId - The component ID to look up.
     * @returns The stored component value, or undefined if the entity lacks this component.
     * @example
     * ```ts
     * const pos = store.get(entity, posId);
     * ```
     */
    get(entity: Entity, componentId: number): unknown {
      const location = locations.get(entity);
      if (!location) return undefined;
      const column = location.archetype.columns.get(componentId);
      if (!column) return undefined;
      return column[location.row];
    },

    /**
     * Iterate all rows of archetypes that contain ALL the requested component IDs.
     *
     * @param componentIds - The required component IDs; only archetypes that are supersets are visited.
     * @yields {ArchetypeRow} An ArchetypeRow for each matching entity in each matching archetype.
     * @example
     * ```ts
     * for (const row of store.iterateArchetype([posId])) {
     *   const pos = row.getValue(posId);
     * }
     * ```
     */
    *iterateArchetype(componentIds: number[]): Iterable<ArchetypeRow> {
      for (const archetype of archetypes.values()) {
        // Only yield from archetypes that are supersets of componentIds
        const isSuperset = componentIds.every(id => archetype.columns.has(id));
        if (!isSuperset) continue;

        const count = archetype.entities.length;
        for (let row = 0; row < count; row++) {
          const entity = archetype.entities[row]!;
          const capturedRow = row;
          const capturedArchetype = archetype;
          yield {
            entity,
            /**
             * Get the stored value for the given component ID at this row.
             *
             * @param componentId - The component ID to retrieve.
             * @returns The component value stored at this row, or undefined if absent.
             * @example
             * ```ts
             * const pos = row.getValue(posId);
             * ```
             */
            getValue(componentId: number): unknown {
              return capturedArchetype.columns.get(componentId)?.[capturedRow];
            }
          };
        }
      }
    }
  };
}

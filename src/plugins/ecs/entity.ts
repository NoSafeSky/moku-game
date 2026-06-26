/**
 * @file ecs plugin — generational entity table (index allocation + recycling).
 *
 * An Entity is a branded number that packs a 16-bit index and a 16-bit generation
 * into a single 32-bit integer: `(generation << 16) | index`. The generation is
 * bumped on every despawn so stale handles are detectably dead via `isAlive`.
 */
import type { Entity } from "./types";

// ─── Internal encoding ────────────────────────────────────────
// Entity = (generation << 16) | index  (both values ≤ 0xFFFF)
const INDEX_BITS = 16;
const INDEX_MASK = 0xff_ff;
const GEN_MASK = 0xff_ff;

/**
 * Encode a raw entity handle from index and generation.
 *
 * @param index - Slot index (0–65535).
 * @param generation - Slot generation counter (0–65535).
 * @returns Branded Entity handle.
 * @example
 * ```ts
 * const entity = encodeEntity(0, 0);
 * ```
 */
const encodeEntity = (index: number, generation: number): Entity =>
  (((generation & GEN_MASK) << INDEX_BITS) | (index & INDEX_MASK)) as Entity;

/**
 * Extract the slot index from an entity handle.
 *
 * @param entity - A branded Entity handle.
 * @returns The slot index.
 * @example
 * ```ts
 * const index = indexOfEntity(entity);
 * ```
 */
const indexOfEntity = (entity: Entity): number => entity & INDEX_MASK;

/**
 * Extract the generation counter from an entity handle.
 *
 * @param entity - A branded Entity handle.
 * @returns The generation value.
 * @example
 * ```ts
 * const gen = generationOfEntity(entity);
 * ```
 */
const generationOfEntity = (entity: Entity): number => (entity >>> INDEX_BITS) & GEN_MASK;

// ─── Entity table ─────────────────────────────────────────────

/** Internal structure returned by createEntityTable. */
export interface EntityTable {
  /** Allocate a new entity handle (recycles a freed slot if available). */
  alloc(): Entity;
  /** Mark the slot as free and bump its generation. */
  free(entity: Entity): void;
  /** True if the handle's generation matches the current slot generation. */
  isAlive(entity: Entity): boolean;
  /** Extract the slot index from an entity handle. */
  indexOf(entity: Entity): number;
  /** Extract the generation from an entity handle. */
  generationOf(entity: Entity): number;
  /** Reserve an index/generation without inserting into archetypes (for deferred spawn). */
  reserve(): Entity;
  /** Snapshot array of every currently-live entity handle (introspection). */
  liveEntities(): Entity[];
  /** Count of currently-live entities (introspection — cheaper than liveEntities().length). */
  liveCount(): number;
}

/**
 * Creates the generational entity table that allocates, recycles, and validates entity handles.
 *
 * Entities are packed as `(generation << 16) | index`. Despawning bumps the generation so
 * any outstanding handle is detectably stale via `isAlive`.
 *
 * @param initialCapacity - Pre-allocated slot count (grows automatically beyond this).
 * @returns The entity table API.
 * @example
 * ```ts
 * const table = createEntityTable(1024);
 * const entity = table.alloc();
 * table.free(entity);
 * table.isAlive(entity); // false
 * ```
 */
export function createEntityTable(initialCapacity: number): EntityTable {
  const generations: number[] = Array.from({ length: initialCapacity }, () => 0);
  const alive: boolean[] = Array.from({ length: initialCapacity }, () => false);
  const freeList: number[] = [];
  let nextIndex = 0;
  // Live-entity counter, kept in sync by alloc/reserve (+1) and free (-1) so liveCount is O(1).
  let liveCount = 0;

  /**
   * Grow the slot arrays to accommodate the given index if needed.
   *
   * @param index - The slot index that must be valid after this call.
   * @example
   * ```ts
   * growIfNeeded(2048);
   * ```
   */
  const growIfNeeded = (index: number): void => {
    while (index >= generations.length) {
      generations.push(0);
      alive.push(false);
    }
  };

  /**
   * Return the next available slot index, preferring recycled slots from the free list.
   *
   * @returns The index to use for the next entity.
   * @example
   * ```ts
   * const index = allocIndex();
   * ```
   */
  const allocIndex = (): number => {
    if (freeList.length > 0) {
      return freeList.pop()!;
    }
    const index = nextIndex;
    nextIndex++;
    growIfNeeded(index);
    return index;
  };

  return {
    /**
     * Allocate a new live entity handle.
     *
     * @returns A fresh Entity handle with the current generation for its slot.
     * @example
     * ```ts
     * const entity = table.alloc();
     * ```
     */
    alloc(): Entity {
      const index = allocIndex();
      alive[index] = true;
      liveCount++;
      return encodeEntity(index, generations[index]!);
    },

    /**
     * Reserve a slot index and generation for a deferred spawn without archetype insertion.
     *
     * @returns A pre-reserved Entity handle that is immediately live.
     * @example
     * ```ts
     * const entity = table.reserve();
     * ```
     */
    reserve(): Entity {
      const index = allocIndex();
      // Mark alive so isAlive works immediately (deferred insertion handles archetype later)
      alive[index] = true;
      liveCount++;
      return encodeEntity(index, generations[index]!);
    },

    /**
     * Release the slot and bump the generation so the old handle is detectably stale.
     *
     * @param entity - The live entity handle to release.
     * @example
     * ```ts
     * table.free(entity);
     * ```
     */
    free(entity: Entity): void {
      const index = indexOfEntity(entity);
      if (!alive[index]) return;
      alive[index] = false;
      liveCount--;
      generations[index] = (generations[index]! + 1) & GEN_MASK;
      freeList.push(index);
    },

    /**
     * Return true if the handle's generation matches the current slot generation.
     *
     * @param entity - The entity handle to validate.
     * @returns Whether the handle refers to a currently live entity.
     * @example
     * ```ts
     * table.isAlive(entity); // false after free
     * ```
     */
    isAlive(entity: Entity): boolean {
      const index = indexOfEntity(entity);
      if (index >= generations.length) return false;
      return alive[index]! && generations[index] === generationOfEntity(entity);
    },

    /**
     * Extract the slot index encoded in the entity handle.
     *
     * @param entity - A branded Entity handle.
     * @returns The 16-bit slot index.
     * @example
     * ```ts
     * const index = table.indexOf(entity);
     * ```
     */
    indexOf(entity: Entity): number {
      return indexOfEntity(entity);
    },

    /**
     * Extract the generation counter encoded in the entity handle.
     *
     * @param entity - A branded Entity handle.
     * @returns The 16-bit generation value.
     * @example
     * ```ts
     * const gen = table.generationOf(entity);
     * ```
     */
    generationOf(entity: Entity): number {
      return generationOfEntity(entity);
    },

    /**
     * Return a snapshot array of every currently-live entity handle.
     *
     * Scans the slot table and encodes each live slot with its current generation.
     * Order follows slot index; the array is a fresh copy.
     *
     * @returns An array of live entity handles.
     * @example
     * ```ts
     * const entities = table.liveEntities();
     * ```
     */
    liveEntities(): Entity[] {
      const result: Entity[] = [];
      for (const [index, isAliveSlot] of alive.entries()) {
        if (isAliveSlot) result.push(encodeEntity(index, generations[index]!));
      }
      return result;
    },

    /**
     * Return the count of currently-live entities (O(1) — maintained by alloc/reserve/free).
     *
     * @returns The number of live entities.
     * @example
     * ```ts
     * const n = table.liveCount();
     * ```
     */
    liveCount(): number {
      return liveCount;
    }
  };
}

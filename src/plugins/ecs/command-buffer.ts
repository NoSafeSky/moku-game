/**
 * @file ecs plugin — deferred structural-op command buffer.
 *
 * During iteration (`iterating === true`), structural mutations (spawn/despawn/add/remove)
 * are enqueued here instead of applied immediately. The buffer is flushed at each stage
 * boundary inside `world.tick`, ensuring consistency during iteration.
 */
import type { Entity } from "./types";

// ─── Op types ────────────────────────────────────────────────

/** A spawn operation (archetype insertion already has reserved entity). */
interface SpawnOp {
  readonly kind: "spawn";
  readonly entity: Entity;
  readonly componentIds: number[];
  readonly values: unknown[];
}

/** A despawn operation. */
interface DespawnOp {
  readonly kind: "despawn";
  readonly entity: Entity;
}

/** An add-component operation. */
interface AddOp {
  readonly kind: "add";
  readonly entity: Entity;
  readonly componentId: number;
  readonly value: unknown;
}

/** A remove-component operation. */
interface RemoveOp {
  readonly kind: "remove";
  readonly entity: Entity;
  readonly componentId: number;
}

/** Union of all deferred structural operations the command buffer can hold. */
type BufferedOp = SpawnOp | DespawnOp | AddOp | RemoveOp;

// ─── Public interface ─────────────────────────────────────────

/** The callbacks the command buffer calls when flushing each op type. */
export interface FlushTarget {
  /** Insert the pre-reserved entity into archetypes. */
  insertSpawned(entity: Entity, componentIds: number[], values: unknown[]): void;
  /** Complete the despawn (archetype removal + entity table free). */
  completeDespawn(entity: Entity): void;
  /** Apply an add-component migration immediately (outside iteration). */
  applyAdd(entity: Entity, componentId: number, value: unknown): void;
  /** Apply a remove-component migration immediately (outside iteration). */
  applyRemove(entity: Entity, componentId: number): void;
}

/** The deferred command buffer API. */
export interface CommandBuffer {
  /** Enqueue an archetype insertion for a pre-reserved entity. */
  enqueueSpawn(entity: Entity, componentIds: number[], values: unknown[]): void;
  /** Enqueue a despawn. */
  enqueueDespawn(entity: Entity): void;
  /** Enqueue an add-component. */
  enqueueAdd(entity: Entity, componentId: number, value: unknown): void;
  /** Enqueue a remove-component. */
  enqueueRemove(entity: Entity, componentId: number): void;
  /** Apply all enqueued ops via the FlushTarget; clears the queue. */
  flush(target: FlushTarget): void;
  /** True if there are pending ops. */
  readonly hasPending: boolean;
}

/**
 * Creates the command buffer that defers structural ops (spawn/despawn/add/remove)
 * to a flush boundary, keeping iteration safe.
 *
 * @returns The command buffer API.
 * @example
 * ```ts
 * const buffer = createCommandBuffer();
 * buffer.enqueueDespawn(entity);
 * buffer.flush(target);
 * ```
 */
export function createCommandBuffer(): CommandBuffer {
  const queue: BufferedOp[] = [];

  return {
    /**
     * True if there are any pending operations that have not yet been flushed.
     *
     * @returns Whether the internal queue contains at least one buffered operation.
     * @example
     * ```ts
     * if (buffer.hasPending) buffer.flush(target);
     * ```
     */
    get hasPending(): boolean {
      return queue.length > 0;
    },

    /**
     * Enqueue an archetype insertion for a pre-reserved entity.
     *
     * @param entity - The pre-reserved entity handle.
     * @param componentIds - Component IDs to insert with the entity.
     * @param values - Parallel array of component values for each ID.
     * @example
     * ```ts
     * buffer.enqueueSpawn(entity, [posId], [{ x: 0, y: 0 }]);
     * ```
     */
    enqueueSpawn(entity: Entity, componentIds: number[], values: unknown[]): void {
      queue.push({ kind: "spawn", entity, componentIds, values });
    },

    /**
     * Enqueue a despawn operation to be applied at the next flush.
     *
     * @param entity - The entity handle to despawn.
     * @example
     * ```ts
     * buffer.enqueueDespawn(entity);
     * ```
     */
    enqueueDespawn(entity: Entity): void {
      queue.push({ kind: "despawn", entity });
    },

    /**
     * Enqueue an add-component operation to be applied at the next flush.
     *
     * @param entity - The entity handle to add the component to.
     * @param componentId - The component ID to add.
     * @param value - The initial value for the component.
     * @example
     * ```ts
     * buffer.enqueueAdd(entity, velId, { dx: 1, dy: 0 });
     * ```
     */
    enqueueAdd(entity: Entity, componentId: number, value: unknown): void {
      queue.push({ kind: "add", entity, componentId, value });
    },

    /**
     * Enqueue a remove-component operation to be applied at the next flush.
     *
     * @param entity - The entity handle to remove the component from.
     * @param componentId - The component ID to remove.
     * @example
     * ```ts
     * buffer.enqueueRemove(entity, velId);
     * ```
     */
    enqueueRemove(entity: Entity, componentId: number): void {
      queue.push({ kind: "remove", entity, componentId });
    },

    /**
     * Drain all enqueued operations by dispatching them to the flush target, then clear the queue.
     *
     * @param target - The flush target whose callbacks apply each operation type.
     * @example
     * ```ts
     * buffer.flush(flushTarget);
     * ```
     */
    flush(target: FlushTarget): void {
      // Drain in insertion order
      while (queue.length > 0) {
        const op = queue.shift()!;
        switch (op.kind) {
          case "spawn": {
            target.insertSpawned(op.entity, op.componentIds, op.values);
            break;
          }
          case "despawn": {
            target.completeDespawn(op.entity);
            break;
          }
          case "add": {
            target.applyAdd(op.entity, op.componentId, op.value);
            break;
          }
          case "remove": {
            target.applyRemove(op.entity, op.componentId);
            break;
          }
        }
      }
    }
  };
}

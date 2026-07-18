/**
 * @file editor-bridge plugin — compound-op orchestrators (pure over the deps' facets).
 *
 * `reparent`/`deleteSubtrees`/`duplicateSubtrees` are the key architecture: each composes as a
 * gesture-bracketed BURST of the existing `commands` primitives (`spawn`/`despawn`/`setField`) —
 * NEVER a new `Command` kind. `editor-history.beginGesture()`/`endGesture()` collapses the whole
 * burst into ONE `HistoryEntry`, so undo/redo of a whole reparent/delete/duplicate is atomic, and
 * each op's inverse falls out of the per-primitive `setField`/`despawn`/`spawn` inverses — zero
 * drift, no bespoke inverse to keep consistent. Pure over four structural facets
 * (`HistoryFacet`/`HierarchyFacet`/`CommandsFacet`/`WorldFacet`), so unit tests drive the exact
 * command bursts + gesture bracketing with stubs — no kernel, no app. `api.ts` supplies the real
 * facets via `ctx.require` and reuses {@link idFromSpawn} for its own single-spawn `create*` verbs.
 */
import type { Command, CommandResult, EditorId } from "../commands/types";
import type { Component, Entity } from "../ecs/types";
import type { NodeValue } from "../hierarchy/types";
import type { TransformValue } from "../renderer/types";
import type { ReparentOptions } from "./types";

/** The `Transform` fields a preserve-world reparent overwrites, in write order. */
const TRANSFORM_FIELDS: readonly (keyof TransformValue)[] = [
  "x",
  "y",
  "rotation",
  "scaleX",
  "scaleY"
];

/** The subset of `editor-history` the orchestrators drive: the tracked write funnel + the gesture brackets that collapse a whole burst into ONE `HistoryEntry`. */
export type HistoryFacet = {
  /** Apply a command through the single write-authority AND record it into the open gesture (or as its own step). */
  applyTracked(command: Command): CommandResult;
  /** Open a gesture: subsequent `applyTracked` calls buffer into ONE step until `endGesture()`. */
  beginGesture(): void;
  /** Close the open gesture, collapsing the buffer into one undo step. */
  endGesture(): void;
};

/** The subset of `hierarchy` the orchestrators read: ordered children, reparent legality, and the reparent math. */
export type HierarchyFacet = {
  /** The Node component token, for the typed `world.get(entity, hierarchy.Node)` read `duplicate` clones. */
  readonly Node: Component<NodeValue>;
  /** The entity's direct children as EditorIds, ordered by `Node.order`. */
  childrenOf(id: EditorId): readonly EditorId[];
  /** Whether `childId` may be reparented under `newParentId` (`false` on a cycle or past `maxDepth`). */
  canReparent(childId: EditorId, newParentId: EditorId | undefined): boolean;
  /** The local `Transform` `childId` must adopt under `newParentId` to keep its WORLD transform unchanged. */
  computeLocalForPreserveWorld(
    childId: EditorId,
    newParentId: EditorId | undefined
  ): TransformValue;
  /** A fractional `Node.order` sort-key between the `before`/`after` siblings under `parentId`. */
  orderBetween(
    parentId: EditorId | undefined,
    before: EditorId | undefined,
    after: EditorId | undefined
  ): number;
};

/** The subset of `commands` the orchestrators read: the Entity ↔ EditorId translation `duplicate`'s clone map needs. */
export type CommandsFacet = {
  /** Resolve an EditorId to its live Entity, or `undefined` if retired/recycled. */
  resolve(id: EditorId): Entity | undefined;
};

/** The subset of the ecs `World` the orchestrators read: the typed `Node` (via `get`) and the full named-component record `duplicate` clones. */
export type WorldFacet = {
  /** Typed component read (undefined if absent/dead) — used to read the source's `Node` without an `as`. */
  get<T extends object>(entity: Entity, component: Component<T>): T | undefined;
  /** The named components currently on an entity, paired with their live values — the clone source record. */
  componentsOf(entity: Entity): ReadonlyArray<{ name: string; value: unknown }>;
};

/** The four facets a compound-op orchestrator composes over — supplied by `api.ts`'s real deps, stubbed by unit tests. */
export type AuthoringFacets = {
  /** The tracked write funnel + gesture brackets. */
  readonly history: HistoryFacet;
  /** The scene-graph read/math surface. */
  readonly hierarchy: HierarchyFacet;
  /** The Entity ↔ EditorId translation. */
  readonly commands: CommandsFacet;
  /** The ecs world read surface. */
  readonly world: WorldFacet;
};

/**
 * Recovers the `EditorId` minted by a `spawn` command from its `CommandResult` — a spawn's inverse
 * is always `{ kind: "despawn", id }`, so the minted id rides there rather than in a bespoke return
 * value. Shared by `duplicateSubtrees` below and by `api.ts`'s single-spawn `create*` verbs.
 *
 * @param result - The `CommandResult` returned by a `spawn` `applyTracked` call.
 * @returns The minted (or re-bound) `EditorId`.
 * @throws {Error} When `result` did not carry a `despawn` inverse — a commands/editor-history
 *   contract violation, since every successful spawn's inverse is a despawn.
 * @example
 * ```ts
 * const id = idFromSpawn(history.applyTracked({ kind: "spawn", components }));
 * ```
 */
export const idFromSpawn = (result: CommandResult): EditorId => {
  if (result.ok && result.inverse.kind === "despawn") return result.inverse.id;
  throw new Error(
    "[game] editor-bridge — a spawn's CommandResult did not carry a despawn inverse.\n" +
      "  This indicates a commands/editor-history contract violation; report it."
  );
};

/**
 * Pre-order (parents-first) walk of `id`'s subtree via `hierarchy.childrenOf` — `id` itself,
 * then each child's subtree, depth-first. `deleteSubtrees` reverses the result for a
 * deepest-first despawn order; `duplicateSubtrees` uses it directly for a parents-first clone order.
 *
 * @param hierarchy - The hierarchy facet slice (`childrenOf`).
 * @param id - The subtree root's editor id.
 * @returns The subtree's ids in pre-order, starting with `id`.
 * @example
 * ```ts
 * collectSubtree(hierarchy, rootId); // [rootId, childId, grandchildId, ...]
 * ```
 */
const collectSubtree = (
  hierarchy: Pick<HierarchyFacet, "childrenOf">,
  id: EditorId
): EditorId[] => {
  const subtree = [id];
  for (const child of hierarchy.childrenOf(id)) subtree.push(...collectSubtree(hierarchy, child));
  return subtree;
};

/**
 * Builds a `{ [componentName]: value }` record of every named component currently on `entity` —
 * the clone source record `duplicateSubtrees` copies (with its `Node` entry remapped) into a fresh
 * `spawn`.
 *
 * @param world - The world facet (`componentsOf`).
 * @param entity - The entity to read.
 * @returns A fresh, mutable record of the entity's named components.
 * @example
 * ```ts
 * const record = componentsRecord(world, entity); // { Transform: {...}, Node: {...} }
 * ```
 */
const componentsRecord = (world: WorldFacet, entity: Entity): Record<string, unknown> => {
  const record: Record<string, unknown> = {};
  for (const component of world.componentsOf(entity)) record[component.name] = component.value;
  return record;
};

/**
 * Re-parents `id` under `newParent` as a gesture-bracketed burst of `setField`s. Validates via
 * `hierarchy.canReparent` BEFORE any gesture: returns `{ ok: false, error }` with NO write on an
 * illegal move (a cycle, or past `maxDepth`). On success, `mode: "preserve-world"` (the default)
 * first writes the five `Transform` fields (from `hierarchy.computeLocalForPreserveWorld`) so the
 * object's WORLD position/rotation/scale do not change, then `Node.parent`, then `Node.order`
 * (from `hierarchy.orderBetween`); `mode: "keep-local"` skips the `Transform` writes. The whole
 * burst collapses to ONE `HistoryEntry`, so its inverse (old parent + old local transform + old
 * order) falls out of the per-field `setField` inverses — zero drift, no new command kind.
 *
 * @param facets - The compound-op facets (`history`/`hierarchy`).
 * @param id - The node being reparented.
 * @param newParent - The candidate new parent, or `undefined` for the scene root.
 * @param opts - Reparent options (`mode`/`before`/`after`).
 * @returns The `CommandResult` of the representative `Node.parent` write on success, else
 *   `{ ok: false, error }` when the move is illegal.
 * @example
 * ```ts
 * const result = reparent(facets, grunt, undefined, { mode: "preserve-world" });
 * ```
 */
export const reparent = (
  facets: AuthoringFacets,
  id: EditorId,
  newParent: EditorId | undefined,
  opts?: ReparentOptions
): CommandResult => {
  const { history, hierarchy } = facets;

  if (!hierarchy.canReparent(id, newParent)) {
    return { ok: false, error: "reparent would create a cycle or exceed maxDepth" };
  }

  history.beginGesture();

  if ((opts?.mode ?? "preserve-world") === "preserve-world") {
    const local = hierarchy.computeLocalForPreserveWorld(id, newParent);
    for (const field of TRANSFORM_FIELDS) {
      history.applyTracked({
        kind: "setField",
        id,
        component: "Transform",
        field,
        value: local[field]
      });
    }
  }

  history.applyTracked({
    kind: "setField",
    id,
    component: "Node",
    field: "parent",
    value: newParent
  });
  const result = history.applyTracked({
    kind: "setField",
    id,
    component: "Node",
    field: "order",
    value: hierarchy.orderBetween(newParent, opts?.before, opts?.after)
  });

  history.endGesture();
  return result;
};

/**
 * Deletes each root's ENTIRE subtree as one gesture-bracketed burst of `despawn`s, deepest-first
 * (every child despawned before its parent). Undo respawns the whole burst shallowest-first: each
 * `despawn`'s inverse is a `spawn` carrying the full original component snapshot — INCLUDING the
 * `Node` component with its original `parent` ref — so the subtree self-heals when the inverses
 * replay in reverse order.
 *
 * @param facets - The compound-op facets (`history`/`hierarchy`).
 * @param ids - The root ids whose subtrees to delete.
 * @example
 * ```ts
 * deleteSubtrees(facets, [parentId]); // parent + all descendants gone; ONE undo entry
 * ```
 */
export const deleteSubtrees = (facets: AuthoringFacets, ids: readonly EditorId[]): void => {
  const { history, hierarchy } = facets;
  history.beginGesture();

  for (const rootId of ids) {
    const subtree = collectSubtree(hierarchy, rootId);
    for (const id of subtree.toReversed()) history.applyTracked({ kind: "despawn", id });
  }

  history.endGesture();
};

/**
 * Clones each root's ENTIRE subtree as one gesture-bracketed burst of `spawn`s, parents-first. Each
 * clone gets a FRESH `EditorId` (recovered via {@link idFromSpawn}) and a remapped `Node.parent`:
 * the top-level clone keeps the source's original parent (a sibling duplicate); a descendant clone
 * points at ITS cloned parent (via the source → clone map built as the walk proceeds parents-first).
 * Returns the top-level clone ids so the caller can select them; undo is the burst of `despawn`
 * inverses, ONE step.
 *
 * @param facets - The compound-op facets (`history`/`hierarchy`/`commands`/`world`).
 * @param ids - The root ids whose subtrees to duplicate.
 * @returns The top-level clone ids, in the same order as `ids`.
 * @example
 * ```ts
 * const clones = duplicateSubtrees(facets, [parentId]); // [clonedParentId]
 * ```
 */
export const duplicateSubtrees = (
  facets: AuthoringFacets,
  ids: readonly EditorId[]
): readonly EditorId[] => {
  const { history, hierarchy, commands, world } = facets;
  history.beginGesture();

  const cloneOf = new Map<EditorId, EditorId>();
  const rootClones: EditorId[] = [];

  for (const rootId of ids) {
    for (const sourceId of collectSubtree(hierarchy, rootId)) {
      const entity = commands.resolve(sourceId);
      if (entity === undefined) continue;

      const sourceNode = world.get(entity, hierarchy.Node);
      if (sourceNode === undefined) continue;

      const newParent =
        sourceNode.parent === undefined
          ? undefined
          : (cloneOf.get(sourceNode.parent) ?? sourceNode.parent);

      const record = componentsRecord(world, entity);
      record.Node = {
        ...sourceNode,
        parent: newParent,
        // place the clone right after its source sibling — `after` is a required positional arg.
        // eslint-disable-next-line unicorn/no-useless-undefined -- undefined is the no-after-constraint order key
        order: hierarchy.orderBetween(newParent, sourceId, undefined)
      };

      const cloneId = idFromSpawn(history.applyTracked({ kind: "spawn", components: record }));
      cloneOf.set(sourceId, cloneId);
      if (sourceId === rootId) rootClones.push(cloneId);
    }
  }

  history.endGesture();
  return Object.freeze(rootClones);
};

/**
 * @file hierarchy plugin — API factory (the `app.hierarchy` surface).
 *
 * Exposes the Node token getter plus the read/math surface: `worldOf` / `parentOf` /
 * `childrenOf` / `roots` / `depth` / `canReparent` / `computeLocalForPreserveWorld` /
 * `orderBetween`. Every method resolves its ecs/renderer/commands dependency LAZILY via
 * `ctx.require(...)` at call time (the `commands`/`reflection`/`scheduler` forwarding-facade
 * pattern) rather than capturing them once at API-construction time — these calls run at
 * editor/gesture frequency, never per-frame, so the per-call `require` (a cheap registry lookup)
 * costs nothing measurable. The one genuinely hot-path consumer of this composition math is the
 * renderer's per-frame, per-view world-transform RESOLVER; `lifecycle.ts`'s `onStart` captures
 * its dependencies once into a tight closure and reuses the exported {@link composeWorldOf} pure
 * function below, so there is exactly one implementation of the composition algorithm shared by
 * both the public API and the injected resolver.
 *
 * `childrenOf`/`roots`/`orderBetween`'s sibling-order memo (`ctx.state.orderIndex`) is rebuilt
 * lazily, gated on a private `orderEpoch` closure variable (not part of the public `State` type)
 * that tracks the `world.changeEpoch()` value the memo was last built at.
 */
import { commandsPlugin } from "../commands";
import type { Api as CommandsApi, EditorId } from "../commands/types";
import { ecsPlugin } from "../ecs";
import type { Component, Entity, World } from "../ecs/types";
import { rendererPlugin } from "../renderer";
import type { Api as RendererApi, TransformValue } from "../renderer/types";
import { compose, IDENTITY, invert } from "./transform";
import type { Api, Config, NodeValue, State } from "./types";

/**
 * Structural context required by {@link createApi}, so unit tests can supply a minimal mock
 * without wiring the full kernel. Only `require`'s three dependency overloads the API actually
 * calls are declared.
 */
export type HierarchyApiContext = {
  /** Resolved hierarchy configuration (`maxDepth`). */
  readonly config: Readonly<Config>;
  /** hierarchy plugin state — started flag, the Node token, and the lazy order memo. */
  readonly state: State;
  /** Require a dependency's API by plugin instance. */
  require: ((plugin: typeof ecsPlugin) => World) &
    ((plugin: typeof rendererPlugin) => RendererApi) &
    ((plugin: typeof commandsPlugin) => CommandsApi);
};

/**
 * Recursively composes an entity's WORLD transform by walking its `Node.parent` chain,
 * root-healing an unresolvable parent (despawned/recycled/dangling) by treating the entity as a
 * root at that link. Depth-capped at `maxDepth` — a pathological/cyclic chain stops composing
 * further rather than recursing unboundedly. Pixi-free, pure over its explicit dependencies, so
 * both the public `worldOf` API method and the tight renderer-resolver closure built in
 * `lifecycle.ts` share this ONE implementation.
 *
 * @param entity - The entity whose world transform to compute.
 * @param world - The ECS world (for `get` reads of the local Transform + Node).
 * @param nodeToken - The Node component token.
 * @param transformToken - The (renderer-owned) local Transform component token.
 * @param resolveParent - Resolves a `Node.parent` EditorId to a live Entity, or `undefined`.
 * @param maxDepth - Remaining recursion budget; composition stops when it reaches `0`.
 * @returns The entity's world-space `TransformValue`.
 * @example
 * ```ts
 * const world = composeWorldOf(entity, world, nodeToken, transformToken, commands.resolve, 64);
 * ```
 */
export const composeWorldOf = (
  entity: Entity,
  world: World,
  nodeToken: Component<NodeValue>,
  transformToken: Component<TransformValue>,
  resolveParent: (id: EditorId) => Entity | undefined,
  maxDepth: number
): TransformValue => {
  const local = world.get(entity, transformToken) ?? IDENTITY;
  if (maxDepth <= 0) return local;

  const node = world.get(entity, nodeToken);
  if (!node || node.parent === undefined) return local;

  const parentEntity = resolveParent(node.parent);
  if (parentEntity === undefined) return local; // root-heal: dangling/despawned parent

  const parentWorld = composeWorldOf(
    parentEntity,
    world,
    nodeToken,
    transformToken,
    resolveParent,
    maxDepth - 1
  );
  return compose(parentWorld, local);
};

/**
 * Creates the hierarchy plugin API surface.
 *
 * @param ctx - Plugin context supplying config, state, and require.
 * @returns The hierarchy plugin {@link Api} object.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * const world = api.worldOf(entity);
 * ```
 */
export function createApi(ctx: HierarchyApiContext): Api {
  /** The `world.changeEpoch()` value `ctx.state.orderIndex` was last rebuilt at. */
  let orderEpoch: number | undefined;

  /**
   * Returns the Node component token defined by `onStart`, throwing if accessed before start —
   * the `renderer.Transform` throw precedent, shared by every method that needs the token.
   *
   * @returns The Node component token.
   * @throws {Error} When accessed before `app.start()` has defined the token.
   * @example
   * ```ts
   * const node = world.get(entity, getNodeToken());
   * ```
   */
  const getNodeToken = (): Component<NodeValue> => {
    const token = ctx.state.nodeToken;
    if (!token) {
      throw new Error(
        "[game] hierarchy.Node accessed before start.\n  Call app.start() before using app.hierarchy.Node."
      );
    }
    return token;
  };

  /**
   * Computes an entity's world transform by resolving the ecs/renderer/commands deps for this
   * call and delegating to the shared {@link composeWorldOf} algorithm.
   *
   * @param entity - The entity whose world transform to compute.
   * @returns The entity's world-space transform.
   * @example
   * ```ts
   * const world = worldOfImpl(entity);
   * ```
   */
  const worldOfImpl = (entity: Entity): TransformValue => {
    const world = ctx.require(ecsPlugin);
    const renderer = ctx.require(rendererPlugin);
    const commands = ctx.require(commandsPlugin);
    return composeWorldOf(
      entity,
      world,
      getNodeToken(),
      renderer.Transform,
      id => commands.resolve(id),
      ctx.config.maxDepth
    );
  };

  /**
   * Returns the sibling-order memo (parent EditorId, or `undefined` for roots, → its ordered
   * children), rebuilding it from a full `Node` scan only when `world.changeEpoch()` has advanced
   * since the last build.
   *
   * @returns The current sibling-order index.
   * @example
   * ```ts
   * const kids = ensureOrderIndex().get(parentId) ?? [];
   * ```
   */
  const ensureOrderIndex = (): ReadonlyMap<EditorId | undefined, readonly EditorId[]> => {
    const world = ctx.require(ecsPlugin);
    const commands = ctx.require(commandsPlugin);
    const epoch = world.changeEpoch();
    if (ctx.state.orderIndex !== undefined && orderEpoch === epoch) {
      return ctx.state.orderIndex;
    }

    const nodeToken = getNodeToken();
    const buckets = new Map<EditorId | undefined, Array<{ id: EditorId; order: number }>>();
    world.query(nodeToken).updateEach((values, entity) => {
      const [node] = values;
      const id = commands.editorIdOf(entity);
      if (id === undefined) return;
      const bucket = buckets.get(node.parent) ?? [];
      bucket.push({ id, order: node.order });
      buckets.set(node.parent, bucket);
    });

    const index = new Map<EditorId | undefined, readonly EditorId[]>();
    for (const [parent, entries] of buckets) {
      index.set(
        parent,
        entries.toSorted((a, b) => a.order - b.order).map(entry => entry.id)
      );
    }

    ctx.state.orderIndex = index;
    orderEpoch = epoch;
    return index;
  };

  /**
   * Walks a node id's `Node.parent` chain upward, counting hops to the root — the EditorId-keyed
   * counterpart of the public `depth(entity)` method, used by `canReparent`'s depth check.
   *
   * @param id - The node id to measure, or `undefined` (treated as depth `0`, i.e. attaching at
   *   the scene root).
   * @returns The node's depth (`0` for a root), capped at `maxDepth`.
   * @example
   * ```ts
   * const newParentDepth = depthOfId(newParentId);
   * ```
   */
  const depthOfId = (id: EditorId | undefined): number => {
    const commands = ctx.require(commandsPlugin);
    const world = ctx.require(ecsPlugin);
    const nodeToken = getNodeToken();

    let currentId = id;
    let hops = 0;
    while (currentId !== undefined && hops < ctx.config.maxDepth) {
      const entity = commands.resolve(currentId);
      if (entity === undefined) return hops;
      const node = world.get(entity, nodeToken);
      if (!node || node.parent === undefined) return hops;
      currentId = node.parent;
      hops++;
    }
    return hops;
  };

  /**
   * Computes the height of the subtree rooted at `id` (`0` for a leaf), used by `canReparent`'s
   * depth check to bound the deepest descendant the reparent would carry along.
   *
   * @param id - The subtree root's node id.
   * @param guard - Remaining recursion budget; recursion stops when it reaches `0`.
   * @returns The subtree height.
   * @example
   * ```ts
   * const height = subtreeHeight(childId, ctx.config.maxDepth);
   * ```
   */
  const subtreeHeight = (id: EditorId, guard: number): number => {
    if (guard <= 0) return 0;
    const kids = ensureOrderIndex().get(id) ?? [];
    let tallest = 0;
    for (const kid of kids) {
      const kidHeight = subtreeHeight(kid, guard - 1);
      if (kidHeight > tallest) tallest = kidHeight;
    }
    return kids.length === 0 ? 0 : tallest + 1;
  };

  /**
   * Whether `ancestorId` lies on `candidateId`'s ancestor chain (i.e. `candidateId` is inside
   * `ancestorId`'s subtree) — the cycle check `canReparent` runs before its depth check.
   *
   * @param ancestorId - The potential ancestor (the reparent's `childId`).
   * @param candidateId - The node to walk upward from (the reparent's `newParentId`).
   * @returns `true` if `ancestorId` is found while walking `candidateId`'s ancestors.
   * @example
   * ```ts
   * if (isAncestorOf(childId, newParentId)) return false; // cycle
   * ```
   */
  const isAncestorOf = (ancestorId: EditorId, candidateId: EditorId): boolean => {
    const commands = ctx.require(commandsPlugin);
    const world = ctx.require(ecsPlugin);
    const nodeToken = getNodeToken();

    let currentId: EditorId | undefined = candidateId;
    let hops = 0;
    while (currentId !== undefined && hops <= ctx.config.maxDepth) {
      if (currentId === ancestorId) return true;
      const entity = commands.resolve(currentId);
      if (entity === undefined) return false;
      const node = world.get(entity, nodeToken);
      currentId = node?.parent;
      hops++;
    }
    return false;
  };

  return {
    /**
     * The Node component token defined on the ecs world by `onStart`. Throws if read before
     * `app.start()`.
     *
     * @returns The Node component token.
     * @throws {Error} When accessed before start.
     * @example
     * ```ts
     * world.spawn(app.hierarchy.Node({ parent: undefined, order: 0, name: "Root", enabled: true }));
     * ```
     */
    get Node(): Component<NodeValue> {
      return getNodeToken();
    },

    /**
     * The entity's WORLD transform — its local `renderer.Transform` composed up the parent
     * chain. Root-heals at READ time when a `Node.parent` is unresolvable.
     *
     * @param entity - The entity whose world transform to compute.
     * @returns The entity's world-space transform.
     * @example
     * ```ts
     * const { x, y } = app.hierarchy.worldOf(entity);
     * ```
     */
    worldOf(entity: Entity): TransformValue {
      return worldOfImpl(entity);
    },

    /**
     * The entity's parent EditorId, or `undefined` when it is a scene root (or has no Node).
     *
     * @param entity - The entity to inspect.
     * @returns The parent EditorId, or `undefined`.
     * @example
     * ```ts
     * const parentId = app.hierarchy.parentOf(entity);
     * ```
     */
    parentOf(entity: Entity): EditorId | undefined {
      const world = ctx.require(ecsPlugin);
      return world.get(entity, getNodeToken())?.parent;
    },

    /**
     * The entity's direct children as EditorIds, ordered by `Node.order`. Returns `[]` when `id`
     * no longer resolves to a live entity (e.g. its owner was despawned) — a dangling `Node.parent`
     * elsewhere is not treated as still belonging to a dead parent.
     *
     * @param id - The parent's EditorId.
     * @returns The ordered child EditorIds, or `[]` when the id has no children or is not live.
     * @example
     * ```ts
     * for (const childId of app.hierarchy.childrenOf(parentId)) { ... }
     * ```
     */
    childrenOf(id: EditorId): readonly EditorId[] {
      const commands = ctx.require(commandsPlugin);
      if (commands.resolve(id) === undefined) return [];
      return ensureOrderIndex().get(id) ?? [];
    },

    /**
     * The top-level (`parent === undefined`) nodes as EditorIds, ordered by `Node.order`.
     *
     * @returns The ordered root EditorIds, or `[]` when the scene has none.
     * @example
     * ```ts
     * const topLevel = app.hierarchy.roots();
     * ```
     */
    roots(): readonly EditorId[] {
      // `undefined` IS the bucket key for scene roots (a Node whose `parent` is unset), not a
      // useless argument — the order index is keyed `EditorId | undefined` by design.
      // eslint-disable-next-line unicorn/no-useless-undefined -- undefined is the roots bucket key
      return ensureOrderIndex().get(undefined) ?? [];
    },

    /**
     * The entity's depth in the tree — `0` for a root, `1` for its child, and so on.
     *
     * @param entity - The entity whose depth to measure.
     * @returns The entity's depth, capped at `maxDepth`.
     * @example
     * ```ts
     * const d = app.hierarchy.depth(entity); // 0 for a root
     * ```
     */
    depth(entity: Entity): number {
      const world = ctx.require(ecsPlugin);
      const commands = ctx.require(commandsPlugin);
      const nodeToken = getNodeToken();

      let current = entity;
      let hops = 0;
      while (hops < ctx.config.maxDepth) {
        const node = world.get(current, nodeToken);
        if (!node || node.parent === undefined) return hops;
        const parentEntity = commands.resolve(node.parent);
        if (parentEntity === undefined) return hops;
        current = parentEntity;
        hops++;
      }
      return hops;
    },

    /**
     * Whether `childId` may be reparented under `newParentId`. Rejects a self-reparent, a cycle
     * (`newParentId` inside `childId`'s subtree), and a move that would push the deepest carried
     * descendant past `maxDepth`.
     *
     * @param childId - The node being reparented.
     * @param newParentId - The candidate new parent, or `undefined` for the scene root.
     * @returns `true` when the reparent is legal.
     * @example
     * ```ts
     * if (app.hierarchy.canReparent(childId, newParentId)) { ... }
     * ```
     */
    canReparent(childId: EditorId, newParentId: EditorId | undefined): boolean {
      if (newParentId === undefined) return true;
      if (newParentId === childId) return false;
      if (isAncestorOf(childId, newParentId)) return false;

      const newParentDepth = depthOfId(newParentId);
      const height = subtreeHeight(childId, ctx.config.maxDepth);
      return newParentDepth + 1 + height <= ctx.config.maxDepth;
    },

    /**
     * The local `Transform` `childId` must adopt under `newParentId` to keep its current WORLD
     * transform unchanged — `compose(invert(worldOf(newParent)), worldOf(child))` (identity
     * parent, i.e. `worldOf(child)` unchanged, when `newParentId` is `undefined`).
     *
     * @param childId - The node being reparented.
     * @param newParentId - The candidate new parent, or `undefined` for the scene root.
     * @returns The local transform to write as the preserve-world `setField Transform`.
     * @example
     * ```ts
     * const local = app.hierarchy.computeLocalForPreserveWorld(childId, newParentId);
     * ```
     */
    computeLocalForPreserveWorld(
      childId: EditorId,
      newParentId: EditorId | undefined
    ): TransformValue {
      const commands = ctx.require(commandsPlugin);
      const childEntity = commands.resolve(childId);
      if (childEntity === undefined) return IDENTITY;

      const childWorld = worldOfImpl(childEntity);
      if (newParentId === undefined) return childWorld;

      const newParentEntity = commands.resolve(newParentId);
      if (newParentEntity === undefined) return childWorld;

      return compose(invert(worldOfImpl(newParentEntity)), childWorld);
    },

    /**
     * A fractional `Node.order` sort-key placing a node between the `before` and `after`
     * siblings (either may be `undefined` for drop-at-start/end).
     *
     * @param _parentId - The siblings' shared parent (unused — `before`/`after` already identify
     *   the siblings; present for call-site clarity and future use).
     * @param before - The sibling immediately before the drop point, or `undefined`.
     * @param after - The sibling immediately after the drop point, or `undefined`.
     * @returns The fractional order value to write as `setField Node.order`.
     * @example
     * ```ts
     * const order = app.hierarchy.orderBetween(parentId, beforeId, afterId);
     * ```
     */
    orderBetween(
      _parentId: EditorId | undefined,
      before: EditorId | undefined,
      after: EditorId | undefined
    ): number {
      const commands = ctx.require(commandsPlugin);
      const world = ctx.require(ecsPlugin);
      const nodeToken = getNodeToken();

      /**
       * Reads a sibling's current `Node.order`, or `undefined` when unset/unresolvable.
       *
       * @param id - The sibling's EditorId, or `undefined`.
       * @returns The sibling's order, or `undefined`.
       * @example
       * ```ts
       * const beforeOrder = orderOf(before);
       * ```
       */
      const orderOf = (id: EditorId | undefined): number | undefined => {
        if (id === undefined) return undefined;
        const entity = commands.resolve(id);
        if (entity === undefined) return undefined;
        return world.get(entity, nodeToken)?.order;
      };

      const beforeOrder = orderOf(before);
      const afterOrder = orderOf(after);
      if (beforeOrder !== undefined && afterOrder !== undefined) {
        return (beforeOrder + afterOrder) / 2;
      }
      if (afterOrder !== undefined) return afterOrder - 1;
      if (beforeOrder !== undefined) return beforeOrder + 1;
      return 0;
    }
  };
}

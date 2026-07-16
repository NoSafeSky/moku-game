/**
 * @file hierarchy plugin — type definitions.
 *
 * The scene-graph node identity (`NodeValue`) + the public read/math surface (`app.hierarchy`).
 * `parent` is a stable EditorId (undefined = scene root); world transforms compose the entity's
 * local renderer Transform up the parent chain.
 */
import type { EditorId } from "../commands/types";
import type { Component, Entity } from "../ecs/types";
import type { TransformValue } from "../renderer/types";

/** hierarchy plugin configuration. */
export type Config = {
  /**
   * Maximum ancestor depth. Bounds the `worldOf` composition recursion and is the depth ceiling
   * `canReparent` rejects past. Must be > 0.
   *
   * @default 64
   */
  maxDepth: number;
};

/** The Node component value — hierarchy expressed as an ordinary component (rides serialization flat). */
export type NodeValue = {
  /** Parent EditorId, or `undefined` when this is a scene root. */
  parent: EditorId | undefined;
  /** Fractional sibling sort-key. */
  order: number;
  /** Display name. */
  name: string;
  /** Active flag — disabled hides the view and (via effectiveEnabled) its subtree. */
  enabled: boolean;
};

/** hierarchy plugin state — started flag, the Node token defined at onStart, and a lazy order memo. */
export type State = {
  /** True once onStart has defined the Node token, registered the system, and injected the resolver. */
  started: boolean;
  /** The Node component token defined on the ecs world by onStart. `undefined` until start. */
  nodeToken: Component<NodeValue> | undefined;
  /**
   * Optional memo of siblings grouped + sorted by `Node.order`, keyed by parent EditorId
   * (undefined = roots). Rebuilt lazily when `world.changeEpoch()` advances.
   */
  orderIndex?: ReadonlyMap<EditorId | undefined, readonly EditorId[]>;
};

/** Public API surface (`app.hierarchy`). */
export type Api = {
  /**
   * The Node component token defined on the ecs world by onStart. Getter — THROWS if read before
   * `app.start()`, mirroring `renderer.Transform`.
   */
  readonly Node: Component<NodeValue>;
  /**
   * The entity's WORLD transform: its local `renderer.Transform` composed up the parent chain.
   * Root-heals at READ time — an unresolvable `Node.parent` is treated as root.
   */
  worldOf(entity: Entity): TransformValue;
  /** The entity's parent EditorId, or `undefined` when it is a scene root (or has no Node). */
  parentOf(entity: Entity): EditorId | undefined;
  /** The entity's direct children as EditorIds, ordered by `Node.order`. */
  childrenOf(id: EditorId): readonly EditorId[];
  /** The top-level (parent === undefined) nodes as EditorIds, ordered by `Node.order`. */
  roots(): readonly EditorId[];
  /** The entity's depth in the tree — `0` for a root (capped at `maxDepth`). */
  depth(entity: Entity): number;
  /**
   * Whether `childId` may be reparented under `newParentId`. `false` on a CYCLE or when the
   * resulting subtree depth would exceed `maxDepth`.
   */
  canReparent(childId: EditorId, newParentId: EditorId | undefined): boolean;
  /**
   * The local `Transform` `childId` must adopt under `newParentId` to keep its current WORLD
   * transform unchanged. The value `editor-bridge.reparent` writes as the preserve-world setField.
   */
  computeLocalForPreserveWorld(
    childId: EditorId,
    newParentId: EditorId | undefined
  ): TransformValue;
  /**
   * A fractional `Node.order` sort-key placing a node between the `before` and `after` siblings
   * (either may be undefined for drop-at-start/end).
   */
  orderBetween(
    parentId: EditorId | undefined,
    before: EditorId | undefined,
    after: EditorId | undefined
  ): number;
};

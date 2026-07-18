/**
 * @file tree-adapter — binds the editor-bridge's flat-with-refs hierarchy snapshot onto a
 * `@headless-tree/core` tree instance and provides the PURE drop-position → bridge-verb-args
 * mapping the hierarchy island routes drags through.
 *
 * The headless-tree instance owns only VIEW-LOCAL structure state — which folders are expanded and
 * the flattened, level-tagged visible order. WORLD state (names, parents, order, enabled, selection)
 * always comes from the polled `EditorSnapshot`, and every mutation goes back out through the bridge:
 * the adapter never edits the world directly. Isolating the binding here (per app-spec Risk #3) keeps
 * the risky drop math — before / after / inside → `reparent` / `reorder` — behind exhaustive unit tests.
 */

import type { TreeInstance } from "@headless-tree/core";
import { createTree, syncDataLoaderFeature } from "@headless-tree/core";
import type { Commands, EditorBridge } from "@nosafesky/ludemic";
import { defaultRangeExtractor } from "@tanstack/virtual-core";

/** The synthetic id of headless-tree's root item — its children are the scene roots; never a visible row. */
export const ROOT_ID = "__scene_root__";

/** One node's data as the tree loads it by string id (headless-tree keys everything by string). */
export type HierarchyItem = {
  /** The entity's editor id in string form (or {@link ROOT_ID} for the synthetic root). */
  readonly id: string;
  /** Display name from the entity's `Node` (empty for a legacy, Node-less entity). */
  readonly name: string;
  /** Active flag from the entity's `Node`. */
  readonly enabled: boolean;
  /** Whether the node has children (drives the twisty + `inside`-drop affordance). */
  readonly isFolder: boolean;
  /** Muted mono component summary, e.g. `"Shape · BoxCollider"` (empty for a bare transform). */
  readonly summary: string;
};

/** The sync data source headless-tree loads structure from (the first `TreeDataLoader` variant, made total). */
export type TreeModel = {
  /** Resolve one node's data by string id (total — never throws). */
  readonly getItem: (id: string) => HierarchyItem;
  /** Resolve one node's ordered child ids by string id (total — `[]` for a leaf/unknown id). */
  readonly getChildren: (id: string) => string[];
};

/** One flattened, visible tree row — what the island renders (headless-tree item projected to plain data). */
export type VisibleRow = {
  /** The entity's branded editor id (routes straight to the bridge verbs). */
  readonly id: Commands.EditorId;
  /** Display name (empty → the island falls back to `#<id>`). */
  readonly name: string;
  /** Active flag (disabled rows render greyed with a red eye-off). */
  readonly enabled: boolean;
  /** Whether the row has children (renders a twisty). */
  readonly isFolder: boolean;
  /** Muted component summary. */
  readonly summary: string;
  /** Depth from the scene root (0 = top-level) — drives the indent. */
  readonly level: number;
  /** Whether the folder is currently expanded (meaningless for leaves). */
  readonly expanded: boolean;
};

/** The live tree engine the hierarchy island drives. */
export type HierarchyTree = {
  /** Register the scroll host + mark mounted so `rebuildTree` materialises rows (call once, on island mount). */
  mount(host: HTMLElement): void;
  /** Swap in a new snapshot's structure and rebuild (call on every epoch change). */
  sync(snapshot: EditorBridge.EditorSnapshot): void;
  /** The current flattened, visible rows (respecting expand/collapse), top-to-bottom. */
  rows(): readonly VisibleRow[];
  /** Toggle a folder's expanded state (twisty click). */
  toggleExpand(id: Commands.EditorId): void;
  /** Release the tree's element + mounted state (island destroy). */
  destroy(): void;
};

/** Where a drop lands relative to the row under the pointer. */
export type DropZone = "before" | "inside" | "after";

/** A resolved drop as the exact bridge verb + args the island should call (or `undefined` for a no-op / illegal drop). */
export type DropPlan =
  | {
      readonly verb: "reparent";
      readonly id: Commands.EditorId;
      readonly newParent: Commands.EditorId | undefined;
      readonly before: Commands.EditorId | undefined;
      readonly after: Commands.EditorId | undefined;
    }
  | {
      readonly verb: "reorder";
      readonly id: Commands.EditorId;
      readonly before: Commands.EditorId | undefined;
      readonly after: Commands.EditorId | undefined;
    };

/** The inputs to {@link planDrop}: the world snapshot plus the drag's dragged/target/zone. */
export type DropInput = {
  /** The snapshot the drag reads parent/children/order from. */
  readonly snapshot: EditorBridge.EditorSnapshot;
  /** The dragged row's editor id. */
  readonly dragged: Commands.EditorId;
  /** The row the pointer is over at release. */
  readonly target: Commands.EditorId;
  /** Where in that row the release landed. */
  readonly zone: DropZone;
};

// An empty snapshot to seed the tree before the first poll (epoch -1 so the island's first real poll rebuilds).
const EMPTY_SNAPSHOT: EditorBridge.EditorSnapshot = {
  epoch: -1,
  entities: [],
  roots: [],
  selection: [],
  mode: "edit",
  canUndo: false,
  canRedo: false
};

// The synthetic root item — never rendered; only its children (the scene roots) surface.
const ROOT_ITEM: HierarchyItem = {
  id: ROOT_ID,
  name: "",
  enabled: true,
  isFolder: true,
  summary: ""
};

// A defensive placeholder for an id that transiently fails to resolve during an epoch swap (never thrown from).
const missingItem = (id: string): HierarchyItem => ({
  id,
  name: "",
  enabled: true,
  isFolder: false,
  summary: ""
});

// The muted mono summary string a row shows — the component names joined, mirroring the design's tree row.
const summarize = (entity: EditorBridge.EntitySnapshot): string =>
  entity.components.map(component => component.name).join(" · ");

// Project one snapshot entity to the tree's per-node data.
const itemOf = (entity: EditorBridge.EntitySnapshot): HierarchyItem => ({
  id: String(entity.id),
  name: entity.name,
  enabled: entity.enabled,
  isFolder: entity.children.length > 0,
  summary: summarize(entity)
});

/**
 * Build the headless-tree data loader over a snapshot — the pure `roots`+`entities` → tree-model mapping.
 * The synthetic {@link ROOT_ID} exposes `snapshot.roots` as its children; every other id resolves from a
 * by-id index. Both accessors are total (an unknown id yields a placeholder + no children) so a rebuild
 * mid-epoch-swap never throws.
 *
 * @param snapshot - The hierarchical editor snapshot.
 * @returns A sync `{ getItem, getChildren }` data loader keyed by string id.
 * @example
 * ```ts
 * const loader = buildDataLoader(bridge.snapshot());
 * loader.getChildren(ROOT_ID); // the scene root ids as strings
 * ```
 */
export function buildDataLoader(snapshot: EditorBridge.EditorSnapshot): TreeModel {
  const byId = new Map<string, EditorBridge.EntitySnapshot>();
  for (const entity of snapshot.entities) byId.set(String(entity.id), entity);

  const getItem = (id: string): HierarchyItem => {
    if (id === ROOT_ID) return ROOT_ITEM;
    const entity = byId.get(id);
    return entity ? itemOf(entity) : missingItem(id);
  };

  const getChildren = (id: string): string[] => {
    if (id === ROOT_ID) return snapshot.roots.map(String);
    return (byId.get(id)?.children ?? []).map(String);
  };

  return { getItem, getChildren };
}

// Every folder id (has ≥1 child) in a snapshot, as strings — the auto-expand set.
const folderIds = (snapshot: EditorBridge.EditorSnapshot): string[] =>
  snapshot.entities.filter(entity => entity.children.length > 0).map(entity => String(entity.id));

/**
 * Create the hierarchy island's live tree engine over a `@headless-tree/core` instance.
 *
 * The instance is genuinely the source of the flattened, level-tagged, expand-aware row order; the
 * adapter layers a "folders open by default, remembers collapses" policy on top (each folder is
 * auto-expanded the first time it appears). `onRender` fires whenever headless-tree's own state changes
 * (expand/collapse) and after each {@link HierarchyTree.sync}, so the island re-renders exactly once per
 * change.
 *
 * @param opts - The tree engine options.
 * @param opts.label - The scroll-container aria label.
 * @param opts.onRender - The island's re-render callback, fired on every structure/expand change.
 * @returns The {@link HierarchyTree} the island mounts, syncs, reads rows from, and destroys.
 * @example
 * ```ts
 * const tree = createHierarchyTree({ label: "Scene", onRender: render });
 * tree.mount(host);
 * onSnapshot(s => { tree.sync(s); render(); });
 * ```
 */
export function createHierarchyTree(opts: {
  readonly label: string;
  readonly onRender: () => void;
}): HierarchyTree {
  let snapshot = EMPTY_SNAPSHOT;
  let loader = buildDataLoader(snapshot);
  const autoExpanded = new Set<string>();

  // The tree reads `loader` through this closure, so `sync` swaps the data source without rebuilding config.
  const tree: TreeInstance<HierarchyItem> = createTree<HierarchyItem>({
    rootItemId: ROOT_ID,
    getItemName: item => item.getItemData().name,
    isItemFolder: item => item.getItemData().isFolder,
    initialState: { expandedItems: [ROOT_ID] },
    setState: () => opts.onRender(),
    dataLoader: {
      getItem: id => loader.getItem(id),
      getChildren: id => loader.getChildren(id)
    },
    features: [syncDataLoaderFeature]
  });

  // Open every not-yet-seen folder so a freshly-seeded (or freshly-nested) tree reads expanded; a user
  // collapse sticks because the folder is already in `autoExpanded` and is never re-expanded.
  const openNewFolders = (): void => {
    for (const id of folderIds(snapshot)) {
      if (autoExpanded.has(id)) continue;
      autoExpanded.add(id);
      tree.getItemInstance(id).expand();
    }
  };

  return {
    mount(host) {
      tree.registerElement(host);
      tree.setMounted(true);
      tree.rebuildTree();
      openNewFolders();
    },

    sync(next) {
      snapshot = next;
      loader = buildDataLoader(next);
      tree.rebuildTree();
      openNewFolders();
    },

    rows() {
      return tree.getItems().map(item => {
        const data = item.getItemData();
        const meta = item.getItemMeta();
        return {
          id: Number(data.id) as Commands.EditorId,
          name: data.name,
          enabled: data.enabled,
          isFolder: data.isFolder,
          summary: data.summary,
          level: meta.level,
          expanded: item.isExpanded()
        };
      });
    },

    toggleExpand(id) {
      const item = tree.getItemInstance(String(id));
      if (item.isExpanded()) item.collapse();
      else item.expand();
    },

    destroy() {
      tree.setMounted(false);
      // headless-tree's unmount contract takes `null` (not `undefined`) to release the element.
      // eslint-disable-next-line unicorn/no-null
      tree.registerElement(null);
    }
  };
}

/**
 * Choose the drop zone from where the pointer sits within a row. A nestable target splits into three
 * bands (before / inside / after); a leaf splits in half (before / after) since it cannot contain children.
 *
 * @param offsetY - Pointer Y relative to the row's top edge, in px.
 * @param height - The row's height in px.
 * @param canNest - Whether the target may receive children (an `inside` drop).
 * @returns The resolved {@link DropZone}.
 * @example
 * ```ts
 * zoneFromOffset(2, 26, true); // "before"
 * ```
 */
export function zoneFromOffset(offsetY: number, height: number, canNest: boolean): DropZone {
  // An unmeasured row (SSR / 0-height) has no meaningful bands — treat as an inside drop.
  if (height <= 0) return "inside";

  const ratio = offsetY / height;
  if (!canNest) return ratio < 0.5 ? "before" : "after";
  if (ratio < 0.28) return "before";
  if (ratio > 0.72) return "after";
  return "inside";
}

// Walk `descendant`'s parent chain to decide whether `ancestor` sits above it — guards against a drop
// that would move a node into its own subtree (which the bridge would reject anyway).
const isAncestorOf = (
  ancestor: Commands.EditorId,
  descendant: Commands.EditorId,
  parentOf: ReadonlyMap<Commands.EditorId, Commands.EditorId | undefined>
): boolean => {
  let cursor = parentOf.get(descendant);
  while (cursor !== undefined) {
    if (cursor === ancestor) return true;
    cursor = parentOf.get(cursor);
  }
  return false;
};

/**
 * Map a drop (dragged row + target row + zone) onto the exact bridge verb + args to call, reading
 * parent/children/order from the snapshot. `inside` re-parents under the target (append); `before`/`after`
 * place the node between the target's siblings — a `reorder` when the parent is unchanged, else a
 * positioned `reparent`. Returns `undefined` for a no-op (drop onto self) or an illegal move (into own
 * subtree); the framework still validates the write, so this is a fast-path guard, not the sole gate.
 *
 * @param input - The snapshot plus the dragged id, target id, and drop zone.
 * @returns The {@link DropPlan}, or `undefined` when the drop should be ignored.
 * @example
 * ```ts
 * planDrop({ snapshot, dragged, target, zone: "inside" });
 * // → { verb: "reparent", id: dragged, newParent: target, before: undefined, after: undefined }
 * ```
 */
export function planDrop(input: DropInput): DropPlan | undefined {
  const { snapshot, dragged, target, zone } = input;

  // Dropping a node relative to itself is always a no-op.
  if (dragged === target) return undefined;

  const byId = new Map<Commands.EditorId, EditorBridge.EntitySnapshot>();
  const parentOf = new Map<Commands.EditorId, Commands.EditorId | undefined>();
  for (const entity of snapshot.entities) {
    byId.set(entity.id, entity);
    parentOf.set(entity.id, entity.parent);
  }

  const targetEntity = byId.get(target);
  if (!targetEntity) return undefined;
  const draggedParent = parentOf.get(dragged);

  // An `inside` drop re-parents the node under the target and appends it (no order anchors).
  if (zone === "inside") {
    if (isAncestorOf(dragged, target, parentOf)) return undefined;
    return {
      verb: "reparent",
      id: dragged,
      newParent: target,
      before: undefined,
      after: undefined
    };
  }

  // A `before`/`after` drop lands among the target's siblings under the target's parent.
  const newParent = targetEntity.parent;
  if (newParent !== undefined && isAncestorOf(dragged, newParent, parentOf)) return undefined;

  const siblings = (
    newParent === undefined ? snapshot.roots : (byId.get(newParent)?.children ?? [])
  ).filter(id => id !== dragged);
  const index = siblings.indexOf(target);

  const before = zone === "before" ? target : siblings[index + 1];
  const after = zone === "before" ? siblings[index - 1] : target;

  // Same parent → a pure sibling reorder; different parent → a positioned reparent.
  if (newParent === draggedParent) {
    return { verb: "reorder", id: dragged, before, after };
  }
  return { verb: "reparent", id: dragged, newParent, before, after };
}

/** Fixed row height (px) the hierarchy virtualizer estimates against — rows are uniform in Slate Precision. */
export const ROW_HEIGHT = 24;

// Below this many rows, windowing costs more than it saves (and unit/SSR contexts can't measure) — render
// all rows so behaviour is identical to a non-virtualized list.
const VIRTUALIZE_ABOVE = 60;

// Extra rows kept mounted just past the viewport so a fast scroll never flashes blank.
const OVERSCAN = 8;

/** A windowed slice of the flat row list: which indices to materialize + the spacer heights around them. */
export type RowWindow = {
  /** The row indices to render, in order. */
  readonly indices: readonly number[];
  /** Height (px) of the spacer above the first rendered row. */
  readonly padTop: number;
  /** Height (px) of the spacer below the last rendered row. */
  readonly padBottom: number;
};

/**
 * Compute which rows to materialize for a virtualized list, using `@tanstack/virtual-core`'s range
 * extractor to add overscan around the measured viewport. Small lists (or unmeasured 0-height containers,
 * as in tests/SSR) render in full — same visible result, no spacers — so virtualization only kicks in for
 * genuinely large, scrollable trees.
 *
 * @param count - Total flat row count.
 * @param scrollTop - The scroll container's current scroll offset (px).
 * @param viewportHeight - The scroll container's visible height (px); `0` = unmeasured.
 * @param rowHeight - Per-row height (px). Defaults to {@link ROW_HEIGHT}.
 * @returns The {@link RowWindow} to render.
 * @example
 * ```ts
 * const { indices, padTop, padBottom } = computeRowWindow(rows.length, el.scrollTop, el.clientHeight);
 * ```
 */
export function computeRowWindow(
  count: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number = ROW_HEIGHT
): RowWindow {
  // Render everything when small or unmeasured — windowing would only add spacer bookkeeping.
  if (count <= VIRTUALIZE_ABOVE || viewportHeight <= 0) {
    return { indices: Array.from({ length: count }, (_, index) => index), padTop: 0, padBottom: 0 };
  }

  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight));
  const endIndex = Math.min(count - 1, Math.floor((scrollTop + viewportHeight) / rowHeight));
  const indices = defaultRangeExtractor({ startIndex, endIndex, overscan: OVERSCAN, count });

  const first = indices[0] ?? 0;
  const last = indices.at(-1) ?? count - 1;
  return { indices, padTop: first * rowHeight, padBottom: (count - 1 - last) * rowHeight };
}

/**
 * @file editor-bridge plugin — public type surface (Config, State, EditorSnapshot tree, Api).
 */
import type { commandsPlugin } from "../commands";
import type { Command, CommandResult, Api as CommandsApi, EditorId } from "../commands/types";
import type { componentRegistryPlugin } from "../component-registry";
import type {
  ComponentCatalogEntry,
  Api as ComponentRegistryApi
} from "../component-registry/types";
import type { ecsPlugin } from "../ecs";
import type { World } from "../ecs/types";
import type { editorGizmosPlugin } from "../editor-gizmos";
import type { Api as EditorGizmosApi } from "../editor-gizmos/types";
import type { editorHistoryPlugin } from "../editor-history";
import type { Api as EditorHistoryApi } from "../editor-history/types";
import type { editorRuntimePlugin } from "../editor-runtime";
import type { Api as EditorRuntimeApi } from "../editor-runtime/types";
import type { editorSelectionPlugin } from "../editor-selection";
import type { Api as EditorSelectionApi } from "../editor-selection/types";
import type { ShapeValue } from "../graphics-2d/types";
import type { hierarchyPlugin } from "../hierarchy";
import type { Api as HierarchyApi } from "../hierarchy/types";
import type { mcpPlugin } from "../mcp";
import type { Api as McpApi } from "../mcp/types";
import type { reflectionPlugin } from "../reflection";
import type { FieldDescriptor, Api as ReflectionApi } from "../reflection/types";
import type { TransformValue } from "../renderer/types";
import type { serializationPlugin } from "../serialization";
import type { Api as SerializationApi } from "../serialization/types";

/**
 * editor-bridge configuration — intentionally EMPTY. The bridge is a pure aggregation + forwarding +
 * orchestration facade: it owns no tunable behavior (every knob lives on a delegated plugin —
 * `hierarchy`'s `maxDepth`, `reflection`'s `humanizeLabels`, `serialization`'s `storageKeyPrefix`,
 * `editor-history`'s `maxDepth`, …). Kept as an explicit `Record<string, never>` so the shape is a
 * documented decision, not an oversight.
 */
export type Config = Record<string, never>;

/**
 * One named component on an entity as an inspector sees it: its component name, current value,
 * and the field descriptors (`reflection.describe`) that tell a panel how to lay it out. NEVER
 * carries `"Node"` — that identity is lifted to the entity level (`name`/`enabled`/`parent`) by
 * {@link EntitySnapshot} instead, so a panel never edits `Node` as a raw component.
 */
export type ComponentSnapshot = {
  /** The registered component name (`world.componentsOf` entry name) — never `"Node"`. */
  readonly name: string;
  /** The live component value at snapshot time (a read-materialized plain object; frozen). */
  readonly value: unknown;
  /** Field descriptors for this component — a registered schema, else inferred, else `[]`. */
  readonly fields: readonly FieldDescriptor[];
};

/**
 * One entity in the (flat) snapshot: its stable `EditorId`, its `Node`-derived identity
 * (`name`/`enabled`/`parent`), its ordered scene-graph children, and its named components
 * (`Node` filtered out — it surfaces at the entity level instead).
 */
export type EntitySnapshot = {
  /** The stable editor id (`commands.editorIdOf`) — the external handle for selection/undo/serialization. */
  readonly id: EditorId;
  /** Display name, from the `Node` component (`""` when a legacy entity has no `Node`). */
  readonly name: string;
  /** Active flag, from the `Node` component (`true` default when `Node` is absent). */
  readonly enabled: boolean;
  /** Parent editor id, from the `Node` component; `undefined` = scene root. */
  readonly parent: EditorId | undefined;
  /** Ordered child editor ids (`hierarchy.childrenOf`, sorted by `Node.order`). */
  readonly children: readonly EditorId[];
  /** The named components on the entity, EXCLUDING the internal `Node`. */
  readonly components: readonly ComponentSnapshot[];
};

/**
 * An immutable, poll-on-epoch, HIERARCHICAL view of the editor world — the ONE read the Preact
 * panels consume on their own tick. `entities` stays FLAT; nesting is re-derived from
 * `parent`/`children`/`roots` (the `@headless-tree/core` flat-node model).
 */
export type EditorSnapshot = {
  /** `world.changeEpoch()` — the monotone per-write counter; the panels' re-render gate. */
  readonly epoch: number;
  /** Every editor-owned live entity (FLAT), each carrying its `Node` identity + parent/children refs. */
  readonly entities: readonly EntitySnapshot[];
  /** Ordered top-level (parentless) editor ids (`hierarchy.roots`) — the tree's seed set. */
  readonly roots: readonly EditorId[];
  /** The current selection as stable editor ids (`editor-selection.selected` mapped via `commands.editorIdOf`). */
  readonly selection: readonly EditorId[];
  /** The current mode (`editor-runtime.mode`). */
  readonly mode: "edit" | "play";
  /** Whether an undo is available (`editor-history.canUndo`). */
  readonly canUndo: boolean;
  /** Whether a redo is available (`editor-history.canRedo`). */
  readonly canRedo: boolean;
};

/**
 * editor-bridge state — the poll-on-epoch memoization cache, and NOTHING else. The facade holds no
 * dep references (each API call resolves its deps via `ctx.require(...)` at call time). The only
 * state is what makes `snapshot()` cheap between world writes: the deeply-frozen STRUCTURAL tree
 * (`entities` + `roots`) keyed by the `changeEpoch` at which it was built. The cheap scalars are
 * never cached.
 */
export type State = {
  /** `world.changeEpoch()` at which `entities`/`roots` were last materialized; `-1` before the first `snapshot()`. */
  lastEpoch: number;
  /** Memoized, deeply-frozen flat entities array from epoch `lastEpoch`; reused verbatim until `changeEpoch` advances. `undefined` before the first `snapshot()`. */
  entities: readonly EntitySnapshot[] | undefined;
  /** Memoized, frozen ordered root ids from epoch `lastEpoch` (structural — invalidated with `entities`). `undefined` before the first `snapshot()`. */
  roots: readonly EditorId[] | undefined;
};

/** A catalog entry enriched with its field schema — one row of the Add-Component picker. */
export type ComponentCatalogEntryWithFields = ComponentCatalogEntry & {
  /** `reflection.describe(entry.name)` — how the inspector lays the component out once added. */
  readonly fields: readonly FieldDescriptor[];
};

/** Options common to the `create*` verbs. */
export type CreateOptions = {
  /** Display name for the new object's `Node` (defaults per verb). */
  readonly name?: string;
  /** Parent editor id; `undefined` = create at scene root. */
  readonly parent?: EditorId;
  /** Initial local transform overrides (merged over the `Transform` defaults). */
  readonly transform?: Partial<TransformValue>;
};

/** Options for `reparent`. */
export type ReparentOptions = {
  /** `"preserve-world"` (default) recomputes the local transform so the object does not visually move; `"keep-local"` keeps the raw local transform. */
  readonly mode?: "preserve-world" | "keep-local";
  /** Drop target: the sibling the object should land BEFORE (fractional order key). */
  readonly before?: EditorId;
  /** Drop target: the sibling the object should land AFTER. */
  readonly after?: EditorId;
};

/** Public API surface (`gameApp["editor-bridge"]`) — the single typed seam the Layer-3 web app consumes. */
export type Api = {
  // ── Read (poll-on-epoch) ────────────────────────────────────────────────────────────────────
  /** The immutable poll-on-epoch HIERARCHICAL snapshot of the editor world (structural tree memoized by `epoch`). */
  snapshot(): EditorSnapshot;

  // ── Generic write funnel (PRESERVED) ───────────────────────────────────────────────────────
  /** Apply a command through the undo-tracked write funnel (`editor-history.applyTracked` → `commands.applyRaw`). */
  apply(command: Command): CommandResult;
  /** Edit one component field on one entity — sugar for `apply({ kind: "setField", … })`; undo-tracked. */
  setField(id: EditorId, component: string, field: string, value: unknown): CommandResult;

  // ── Authoring verbs (NEW — each is one atomic undo step; compounds are gesture-bracketed bursts) ──
  /** Create an empty object (Transform + Node). Returns the minted editor id. */
  create(opts?: CreateOptions): EditorId;
  /** Create an object with a Shape component (defaults from `component-registry`, overlaid by `opts.shape`). */
  createShape(
    kind: "rect" | "circle",
    opts?: CreateOptions & { shape?: Partial<ShapeValue> }
  ): EditorId;
  /** Create an object with a SpriteRenderer bound to `alias`. */
  createSprite(alias: string, opts?: CreateOptions): EditorId;
  /** Delete the given objects and ALL descendants — cascade; ONE undo entry (a burst of despawns, deepest-first). */
  delete(...ids: EditorId[]): void;
  /** Subtree-aware clone of the given objects (a burst of spawns); ONE undo entry; SELECTS the clones. Returns the top-level clone ids. */
  duplicate(...ids: EditorId[]): readonly EditorId[];
  /** Re-parent `id` under `newParent` (`undefined` = root) — gesture burst: (preserve-world) local Transform + `Node.parent` + `Node.order`. Validated via `hierarchy.canReparent`. */
  reparent(id: EditorId, newParent: EditorId | undefined, opts?: ReparentOptions): CommandResult;
  /** Move `id` between two siblings (`Node.order` via `hierarchy.orderBetween`); undo-tracked. */
  reorder(id: EditorId, before: EditorId | undefined, after: EditorId | undefined): void;
  /** Rename `id` (`setField Node.name`); undo-tracked. */
  rename(id: EditorId, name: string): void;
  /** Toggle `id`'s active flag (`setField Node.enabled`); undo-tracked. */
  setEnabled(id: EditorId, enabled: boolean): void;
  /** Add a named component with `component-registry` defaults (`applyTracked addComponent`). */
  addComponent(id: EditorId, component: string): CommandResult;
  /** Remove a named component (`applyTracked removeComponent`). */
  removeComponent(id: EditorId, component: string): CommandResult;
  /** The addable-component catalog enriched with each entry's field schema — for the Add-Component picker. */
  listComponents(): readonly ComponentCatalogEntryWithFields[];

  // ── Selection / history / runtime / persistence / schema (PRESERVED) ──────────────────────
  /** Set the selection to the given editor ids (resolved to live entities via `commands.resolve`). */
  select(...ids: EditorId[]): void;
  /** Clear the selection. */
  clearSelection(): void;
  /** Undo the last tracked edit (`editor-history.undo`). */
  undo(): void;
  /** Redo the last undone edit (`editor-history.redo`). */
  redo(): void;
  /** Enter play mode (`editor-runtime.enterPlay`). */
  play(): void;
  /** Exit play mode, reverting to the pre-play snapshot (`editor-runtime.stop`). */
  stop(): void;
  /** Advance one frame while paused (`editor-runtime.step`). */
  step(): void;
  /** Persist the current scene under `name` (`serialization.save`; storage-backed). */
  save(name: string): boolean;
  /** Load a persisted scene by `name` (`serialization.load` → `commands.restore`; clears history). Returns `false` if absent. */
  load(name: string): boolean;
  /** The field descriptors for a component name (`reflection.describe`) — for a not-yet-instantiated component. */
  describe(componentName: string): FieldDescriptor[];
};

/** Logger surface injected by the common logPlugin (`ctx.log`). */
export type Log = {
  /** Log at debug level. */
  debug(message: string): void;
  /** Log at info level. */
  info(message: string): void;
  /** Log a warning. */
  warn(message: string): void;
  /** Log an error. */
  error(message: string): void;
};

/**
 * Every dependency editor-bridge reaches via `ctx.require`, one call signature per plugin
 * instance — the `serialization`/`editor-runtime` intersection pattern for a plugin with several
 * `require`d dependencies resolved at call time rather than captured in `onStart`. Shared between
 * `api.ts` (snapshot aggregation + forwarding + authoring orchestration) and `lifecycle.ts` (the
 * onStart decoupling seams). Grows by two members (`hierarchy`, `component-registry`) for the
 * Phase-1 hierarchical snapshot + authoring verbs; both are resolved at call time — neither needs
 * `onStart` wiring.
 */
export type EditorBridgeRequire = ((plugin: typeof ecsPlugin) => World) &
  ((plugin: typeof reflectionPlugin) => ReflectionApi) &
  ((plugin: typeof commandsPlugin) => CommandsApi) &
  ((plugin: typeof hierarchyPlugin) => HierarchyApi) &
  ((plugin: typeof componentRegistryPlugin) => ComponentRegistryApi) &
  ((plugin: typeof editorSelectionPlugin) => EditorSelectionApi) &
  ((plugin: typeof editorGizmosPlugin) => EditorGizmosApi) &
  ((plugin: typeof editorHistoryPlugin) => EditorHistoryApi) &
  ((plugin: typeof editorRuntimePlugin) => EditorRuntimeApi) &
  ((plugin: typeof serializationPlugin) => SerializationApi) &
  ((plugin: typeof mcpPlugin) => McpApi);

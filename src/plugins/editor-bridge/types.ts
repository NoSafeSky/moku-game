/**
 * @file editor-bridge plugin — public type surface (Config, State, EditorSnapshot tree, Api).
 */
import type { Command, CommandResult, EditorId } from "../commands/types";
import type { FieldDescriptor } from "../reflection/types";

/**
 * editor-bridge configuration — intentionally EMPTY. The bridge is a pure aggregation + forwarding
 * facade: it owns no tunable behavior (every knob lives on the delegated plugin). Kept as an explicit
 * `Record<string, never>` so the shape is a documented decision, not an oversight.
 */
export type Config = Record<string, never>;

/**
 * One named component on an entity as an inspector sees it: its component name, current value,
 * and the field descriptors (`reflection.describe`) that tell a panel how to lay it out.
 */
export type ComponentSnapshot = {
  /** The registered component name (`world.componentsOf` entry name). */
  readonly name: string;
  /** The live component value at snapshot time (a read-materialized plain object; frozen). */
  readonly value: unknown;
  /** Field descriptors for this component — a registered schema, else inferred, else `[]`. */
  readonly fields: readonly FieldDescriptor[];
};

/** One entity in the snapshot: its stable, save-durable `EditorId` and its named components. */
export type EntitySnapshot = {
  /** The stable editor id (`commands.editorIdOf`) — the external handle for selection/undo/serialization. */
  readonly id: EditorId;
  /** The named components currently on the entity (anonymous components are omitted by `componentsOf`). */
  readonly components: readonly ComponentSnapshot[];
};

/**
 * An immutable, poll-on-epoch view of the whole editor world — the ONE read the Preact panels
 * consume on their own tick. Re-materialize the heavy `entities` tree only when `epoch` changes.
 */
export type EditorSnapshot = {
  /** `world.changeEpoch()` — the monotone per-write counter; the panels' re-render gate. */
  readonly epoch: number;
  /** Every editor-owned live entity with its named components + field descriptors. */
  readonly entities: readonly EntitySnapshot[];
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
 * editor-bridge state — the poll-on-epoch memoization cache, and NOTHING else. Each API call
 * resolves its deps via `ctx.require(...)` at call time. The only state is what makes `snapshot()`
 * cheap between world writes.
 */
export type State = {
  /** `world.changeEpoch()` at which `entities` was last materialized; `-1` before the first `snapshot()`. */
  lastEpoch: number;
  /** Memoized, deeply-frozen entities array from epoch `lastEpoch`; reused until `changeEpoch` advances. `undefined` before the first `snapshot()`. */
  entities: readonly EntitySnapshot[] | undefined;
};

/** Public API surface (`gameApp["editor-bridge"]`) — the single typed seam the Layer-3 web app consumes. */
export type Api = {
  /** The immutable poll-on-epoch snapshot of the editor world (memoized by `epoch`). */
  snapshot(): EditorSnapshot;
  /** Apply a command through the undo-tracked write funnel (`editor-history.applyTracked` → `commands.applyRaw`). */
  apply(command: Command): CommandResult;
  /** Edit one component field on one entity — sugar for `apply({ kind: "setField", … })`; undo-tracked. */
  setField(id: EditorId, component: string, field: string, value: unknown): CommandResult;
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
  /** The field descriptors for a component name (`reflection.describe`) — for panels needing a schema for a not-yet-instantiated component. */
  describe(componentName: string): FieldDescriptor[];
};

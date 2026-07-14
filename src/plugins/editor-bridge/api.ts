/**
 * @file editor-bridge plugin — API factory (the `app["editor-bridge"]` surface).
 *
 * `snapshot()` is the one aggregation read: it memoizes the heavy entity tree by
 * `world.changeEpoch()` (delegating the walk to the pure `buildEntities` in `snapshot.ts`) and
 * re-reads the cheap scalars (`selection`/`mode`/`canUndo`/`canRedo`) fresh on every call. Every
 * other method is a thin forward to the single write-authority or the owning dep — `apply`/
 * `setField` route through `editor-history.applyTracked` (never touch `world` directly);
 * `select`/`clearSelection` route through `editor-selection`; `undo`/`redo` route through
 * `editor-history`; `play`/`stop`/`step` route through `editor-runtime`; `save`/`load` route
 * through `serialization`; `describe` passes straight through to `reflection`. Every dependency is
 * resolved via `ctx.require(plugin)` at call time — the bridge holds no captured dep reference
 * (the `reflection`/`scheduler` no-capture precedent).
 */
import { commandsPlugin } from "../commands";
import type { Command, CommandResult, EditorId } from "../commands/types";
import { ecsPlugin } from "../ecs";
import { editorHistoryPlugin } from "../editor-history";
import { editorRuntimePlugin } from "../editor-runtime";
import { editorSelectionPlugin } from "../editor-selection";
import { reflectionPlugin } from "../reflection";
import type { FieldDescriptor } from "../reflection/types";
import { serializationPlugin } from "../serialization";
import { buildEntities } from "./snapshot";
import type { Api, Config, EditorBridgeRequire, EditorSnapshot, Log, State } from "./types";

/**
 * Structural context required by {@link createApi}, so unit tests can pass a minimal mock without
 * wiring the full kernel. Mirrors `reflection`'s no-capture pattern — every dependency is
 * resolved via `require` at call time; `State` holds only the epoch memoization cache.
 */
export type EditorBridgeApiContext = {
  /** Resolved editor-bridge configuration (intentionally empty). */
  readonly config: Readonly<Config>;
  /** editor-bridge plugin state — the epoch memoization cache (`lastEpoch`/`entities`). */
  readonly state: State;
  /** Logger from `logPlugin` (the skipped-select warning). */
  readonly log: Log;
  /** Require a dependency's API by plugin instance, resolved at call time. */
  readonly require: EditorBridgeRequire;
};

/**
 * Type guard dropping `undefined` — narrows an array produced by a partial mapping (e.g.
 * `EditorId | undefined`) down to its defined members.
 *
 * @param value - The candidate value.
 * @returns `true` (narrowing to `T`) when `value` is not `undefined`.
 * @example
 * ```ts
 * [1, undefined, 2].filter(entry => isDefined(entry)); // [1, 2]
 * ```
 */
const isDefined = <T>(value: T | undefined): value is T => value !== undefined;

/**
 * Builds the poll-on-epoch `EditorSnapshot`. Memoizes the heavy entity tree in `ctx.state` keyed
 * by `world.changeEpoch()` (reused verbatim while unchanged); re-reads the cheap scalars
 * (`selection`/`mode`/`canUndo`/`canRedo`) fresh every call.
 *
 * @param ctx - The editor-bridge API context.
 * @returns A frozen {@link EditorSnapshot}.
 * @example
 * ```ts
 * const s = buildSnapshot(ctx);
 * ```
 */
const buildSnapshot = (ctx: EditorBridgeApiContext): EditorSnapshot => {
  const world = ctx.require(ecsPlugin);
  const commands = ctx.require(commandsPlugin);
  const reflection = ctx.require(reflectionPlugin);

  const epoch = world.changeEpoch();
  if (ctx.state.entities === undefined || epoch !== ctx.state.lastEpoch) {
    ctx.state.entities = buildEntities(world, commands, reflection);
    ctx.state.lastEpoch = epoch;
  }

  const selection = Object.freeze(
    ctx
      .require(editorSelectionPlugin)
      .selected()
      .map(entity => commands.editorIdOf(entity))
      .filter(entry => isDefined(entry))
  );
  const runtime = ctx.require(editorRuntimePlugin);
  const history = ctx.require(editorHistoryPlugin);

  return Object.freeze({
    epoch,
    entities: ctx.state.entities,
    selection,
    mode: runtime.mode(),
    canUndo: history.canUndo(),
    canRedo: history.canRedo()
  });
};

/**
 * Resolves each editor id to a live entity and drives the selection to exactly that set: clears
 * first, then toggles each resolvable entity in order. An id whose `commands.resolve` is
 * `undefined` (retired/recycled) is skipped with a warning — it never throws.
 *
 * @param ctx - The editor-bridge API context.
 * @param ids - The editor ids to select.
 * @example
 * ```ts
 * selectIds(ctx, [playerId, enemyId]);
 * ```
 */
const selectIds = (ctx: EditorBridgeApiContext, ids: readonly EditorId[]): void => {
  const commands = ctx.require(commandsPlugin);
  const selection = ctx.require(editorSelectionPlugin);
  selection.clear();

  for (const id of ids) {
    const entity = commands.resolve(id);
    if (entity === undefined) {
      ctx.log.warn(`[editor-bridge] select — editor id ${id} not alive; skipped.`);
      continue;
    }
    selection.toggle(entity);
  }
};

/**
 * Creates the editor-bridge plugin API surface.
 *
 * @param ctx - Plugin context (structural — config/state/log/require).
 * @returns The editor-bridge {@link Api} object.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * api.snapshot();
 * ```
 */
export const createApi = (ctx: EditorBridgeApiContext): Api => ({
  /**
   * The immutable poll-on-epoch snapshot of the editor world (memoized by `epoch`).
   *
   * @returns A frozen {@link EditorSnapshot}.
   * @example
   * ```ts
   * app["editor-bridge"].snapshot();
   * ```
   */
  snapshot: (): EditorSnapshot => buildSnapshot(ctx),

  /**
   * Applies a command through the undo-tracked write funnel (`editor-history.applyTracked` →
   * `commands.applyRaw`). Never touches `world` directly.
   *
   * @param command - The command to apply.
   * @returns The {@link CommandResult} relayed from `editor-history`.
   * @example
   * ```ts
   * app["editor-bridge"].apply({ kind: "despawn", id });
   * ```
   */
  apply: (command: Command): CommandResult =>
    ctx.require(editorHistoryPlugin).applyTracked(command),

  /**
   * Edits one component field on one entity — sugar for `apply({ kind: "setField", … })`;
   * undo-tracked.
   *
   * @param id - The target entity's stable editor id.
   * @param component - The component name.
   * @param field - The field key within the component.
   * @param value - The new field value.
   * @returns The {@link CommandResult} relayed from `editor-history`.
   * @example
   * ```ts
   * app["editor-bridge"].setField(playerId, "Transform", "x", 128);
   * ```
   */
  setField: (id: EditorId, component: string, field: string, value: unknown): CommandResult => {
    const command: Command = { kind: "setField", id, component, field, value };
    return ctx.require(editorHistoryPlugin).applyTracked(command);
  },

  /**
   * Sets the selection to the given editor ids (resolved to live entities via
   * `commands.resolve`). An unresolvable id is skipped with a `ctx.log.warn`.
   *
   * @param ids - The editor ids to select.
   * @example
   * ```ts
   * app["editor-bridge"].select(enemyId);
   * ```
   */
  select: (...ids: EditorId[]): void => {
    selectIds(ctx, ids);
  },

  /**
   * Clears the selection.
   *
   * @example
   * ```ts
   * app["editor-bridge"].clearSelection();
   * ```
   */
  clearSelection: (): void => {
    ctx.require(editorSelectionPlugin).clear();
  },

  /**
   * Undoes the last tracked edit (`editor-history.undo`).
   *
   * @example
   * ```ts
   * app["editor-bridge"].undo();
   * ```
   */
  undo: (): void => {
    ctx.require(editorHistoryPlugin).undo();
  },

  /**
   * Redoes the last undone edit (`editor-history.redo`).
   *
   * @example
   * ```ts
   * app["editor-bridge"].redo();
   * ```
   */
  redo: (): void => {
    ctx.require(editorHistoryPlugin).redo();
  },

  /**
   * Enters play mode (`editor-runtime.enterPlay`).
   *
   * @example
   * ```ts
   * app["editor-bridge"].play();
   * ```
   */
  play: (): void => {
    ctx.require(editorRuntimePlugin).enterPlay();
  },

  /**
   * Exits play mode, reverting to the pre-play snapshot (`editor-runtime.stop`).
   *
   * @example
   * ```ts
   * app["editor-bridge"].stop();
   * ```
   */
  stop: (): void => {
    ctx.require(editorRuntimePlugin).stop();
  },

  /**
   * Advances one frame while paused (`editor-runtime.step`).
   *
   * @example
   * ```ts
   * app["editor-bridge"].step();
   * ```
   */
  step: (): void => {
    ctx.require(editorRuntimePlugin).step();
  },

  /**
   * Persists the current scene under `name` (`serialization.save`; storage-backed).
   *
   * @param name - The save-slot name.
   * @returns `serialization`'s success flag.
   * @example
   * ```ts
   * app["editor-bridge"].save("level1");
   * ```
   */
  save: (name: string): boolean => ctx.require(serializationPlugin).save(name),

  /**
   * Loads a persisted scene by `name` (`serialization.load` → `commands.restore`; clears
   * history).
   *
   * @param name - The save-slot name.
   * @returns `false` if the scene is absent (no world change).
   * @example
   * ```ts
   * app["editor-bridge"].load("level1");
   * ```
   */
  load: (name: string): boolean => ctx.require(serializationPlugin).load(name),

  /**
   * The field descriptors for a component name (`reflection.describe`) — for panels that need a
   * schema for a not-yet-instantiated component.
   *
   * @param componentName - The component name to describe.
   * @returns The component's field descriptors.
   * @example
   * ```ts
   * app["editor-bridge"].describe("Transform");
   * ```
   */
  describe: (componentName: string): FieldDescriptor[] =>
    ctx.require(reflectionPlugin).describe(componentName)
});

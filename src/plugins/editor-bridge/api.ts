/**
 * @file editor-bridge plugin — API factory (the `app["editor-bridge"]` surface).
 *
 * `snapshot()` is the one aggregation read: it memoizes the heavy STRUCTURAL tree (`entities` +
 * `roots`) by `world.changeEpoch()` (delegating the walk to the pure `buildEntities` in
 * `snapshot.ts`) and re-reads the cheap scalars (`selection`/`mode`/`canUndo`/`canRedo`) fresh on
 * every call. Every simple write (`apply`/`setField`/`rename`/`setEnabled`/`reorder`/
 * `addComponent`/`removeComponent`/`create*`) routes through the single write-authority
 * (`editor-history.applyTracked` → `commands.applyRaw`); the three COMPOUND ops
 * (`reparent`/`delete`/`duplicate`) delegate to the pure orchestrators in `authoring.ts`, which
 * bracket their bursts of primitives into ONE undo entry. `select`/`clearSelection` route through
 * `editor-selection`; `undo`/`redo` route through `editor-history`; `play`/`stop`/`step` route
 * through `editor-runtime`; `save`/`load` route through `serialization`; `describe`/
 * `listComponents` read straight through `reflection`/`component-registry`. Every dependency is
 * resolved via `ctx.require(plugin)` at call time — the bridge holds no captured dep reference
 * (the `reflection`/`scheduler` no-capture precedent).
 */
import { commandsPlugin } from "../commands";
import type { Command, CommandResult, EditorId } from "../commands/types";
import { componentRegistryPlugin } from "../component-registry";
import { ecsPlugin } from "../ecs";
import { editorHistoryPlugin } from "../editor-history";
import { editorRuntimePlugin } from "../editor-runtime";
import { editorSelectionPlugin } from "../editor-selection";
import type { ShapeValue } from "../graphics-2d/types";
import { hierarchyPlugin } from "../hierarchy";
import type { NodeValue } from "../hierarchy/types";
import { reflectionPlugin } from "../reflection";
import type { FieldDescriptor } from "../reflection/types";
import { serializationPlugin } from "../serialization";
import type { AuthoringFacets } from "./authoring";
import {
  deleteSubtrees,
  duplicateSubtrees,
  idFromSpawn,
  reparent as reparentSubtrees
} from "./authoring";
import { buildEntities } from "./snapshot";
import type {
  Api,
  ComponentCatalogEntryWithFields,
  Config,
  CreateOptions,
  EditorBridgeRequire,
  EditorSnapshot,
  Log,
  ReparentOptions,
  State
} from "./types";

/**
 * Structural context required by {@link createApi}, so unit tests can pass a minimal mock without
 * wiring the full kernel. Mirrors `reflection`'s no-capture pattern — every dependency is
 * resolved via `require` at call time; `State` holds only the epoch memoization cache.
 */
export type EditorBridgeApiContext = {
  /** Resolved editor-bridge configuration (intentionally empty). */
  readonly config: Readonly<Config>;
  /** editor-bridge plugin state — the epoch memoization cache (`lastEpoch`/`entities`/`roots`). */
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
 * Builds the poll-on-epoch `EditorSnapshot`. Memoizes the heavy STRUCTURAL tree (`entities` +
 * `roots`) in `ctx.state` keyed by `world.changeEpoch()` (reused verbatim while unchanged);
 * re-reads the cheap scalars (`selection`/`mode`/`canUndo`/`canRedo`) fresh every call.
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
  const hierarchy = ctx.require(hierarchyPlugin);

  const epoch = world.changeEpoch();
  let entities = ctx.state.entities;
  let roots = ctx.state.roots;
  if (entities === undefined || roots === undefined || epoch !== ctx.state.lastEpoch) {
    entities = buildEntities(world, commands, reflection, hierarchy);
    roots = Object.freeze(hierarchy.roots().map(id => id));
    ctx.state.entities = entities;
    ctx.state.roots = roots;
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
    entities,
    roots,
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
 * Composes the four structural facets `authoring.ts`'s compound-op orchestrators run over from
 * the real deps — each real Api is a structural superset of its narrow facet, so no adapter is
 * needed beyond the plugin lookups themselves.
 *
 * @param ctx - The editor-bridge API context.
 * @returns The {@link AuthoringFacets} for `reparent`/`delete`/`duplicate`.
 * @example
 * ```ts
 * deleteSubtrees(buildAuthoringFacets(ctx), ids);
 * ```
 */
const buildAuthoringFacets = (ctx: EditorBridgeApiContext): AuthoringFacets => ({
  history: ctx.require(editorHistoryPlugin),
  hierarchy: ctx.require(hierarchyPlugin),
  commands: ctx.require(commandsPlugin),
  world: ctx.require(ecsPlugin)
});

/**
 * Builds the shared `Transform` + `Node` components every `create*` verb spawns: `Transform`
 * defaulted from `component-registry.get("Transform")?.defaults` (falling back to the ecs world's
 * own component default when the registry has no entry) overlaid by `opts.transform`, and a fresh
 * `Node` at `opts.parent` with a sibling order from `hierarchy.orderBetween`.
 *
 * @param ctx - The editor-bridge API context.
 * @param defaultName - The display name to use when `opts.name` is omitted.
 * @param opts - The `create*` verb's shared options.
 * @returns A `{ Transform, Node }` components record, ready to overlay a renderable component onto.
 * @example
 * ```ts
 * const base = buildBaseComponents(ctx, "", opts);
 * ```
 */
const buildBaseComponents = (
  ctx: EditorBridgeApiContext,
  defaultName: string,
  opts: CreateOptions | undefined
): Record<string, unknown> => {
  const registry = ctx.require(componentRegistryPlugin);
  const hierarchy = ctx.require(hierarchyPlugin);

  const transform = { ...registry.get("Transform")?.defaults, ...opts?.transform };
  const node: NodeValue = {
    parent: opts?.parent,
    // append at scene end — before/after are required positional args typed `EditorId | undefined`.
    // eslint-disable-next-line unicorn/no-useless-undefined -- undefined is the no-sibling-constraint order key
    order: hierarchy.orderBetween(opts?.parent, undefined, undefined),
    name: opts?.name ?? defaultName,
    enabled: true
  };

  return { Transform: transform, Node: node };
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
   * The immutable poll-on-epoch HIERARCHICAL snapshot of the editor world (structural tree
   * memoized by `epoch`).
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
   * Creates an empty object (a `Transform` + `Node` only). One `spawn` command → ONE atomic undo
   * entry. Returns the minted editor id, recovered from the spawn's `despawn` inverse.
   *
   * @param opts - Name/parent/transform overrides.
   * @returns The newly minted `EditorId`.
   * @example
   * ```ts
   * const enemies = app["editor-bridge"].create({ name: "Enemies" });
   * ```
   */
  create: (opts?: CreateOptions): EditorId => {
    const components = buildBaseComponents(ctx, "", opts);
    const result = ctx.require(editorHistoryPlugin).applyTracked({ kind: "spawn", components });
    return idFromSpawn(result);
  },

  /**
   * Creates an object with a `Shape` component, defaulted from `component-registry.get("Shape")`
   * and overlaid by `opts.shape`. One `spawn` command → ONE atomic undo entry.
   *
   * @param kind - The primitive kind (`"rect"` or `"circle"`).
   * @param opts - Name/parent/transform overrides, plus `shape` style overrides.
   * @returns The newly minted `EditorId`.
   * @example
   * ```ts
   * const grunt = app["editor-bridge"].createShape("rect", { name: "Grunt", shape: { fill: "#D9534F" } });
   * ```
   */
  createShape: (
    kind: "rect" | "circle",
    opts?: CreateOptions & { shape?: Partial<ShapeValue> }
  ): EditorId => {
    const registry = ctx.require(componentRegistryPlugin);
    const defaultName = kind === "rect" ? "Rect" : "Circle";
    const base = buildBaseComponents(ctx, defaultName, opts);
    const shape = { ...registry.get("Shape")?.defaults, kind, ...opts?.shape };
    const result = ctx.require(editorHistoryPlugin).applyTracked({
      kind: "spawn",
      components: { ...base, Shape: shape }
    });
    return idFromSpawn(result);
  },

  /**
   * Creates an object with a `SpriteRenderer` bound to `alias`, defaulted from
   * `component-registry.get("SpriteRenderer")`. One `spawn` command → ONE atomic undo entry.
   *
   * @param alias - The texture alias the `SpriteRenderer` binds to.
   * @param opts - Name/parent/transform overrides.
   * @returns The newly minted `EditorId`.
   * @example
   * ```ts
   * const hero = app["editor-bridge"].createSprite("hero.png", { name: "Hero" });
   * ```
   */
  createSprite: (alias: string, opts?: CreateOptions): EditorId => {
    const registry = ctx.require(componentRegistryPlugin);
    const base = buildBaseComponents(ctx, alias, opts);
    const sprite = { ...registry.get("SpriteRenderer")?.defaults, sprite: alias };
    const result = ctx.require(editorHistoryPlugin).applyTracked({
      kind: "spawn",
      components: { ...base, SpriteRenderer: sprite }
    });
    return idFromSpawn(result);
  },

  /**
   * Deletes the given objects and ALL their descendants — a gesture-bracketed burst of despawns,
   * deepest-first. ONE atomic undo entry; undo respawns the whole subtree, self-healing every
   * `Node.parent` ref.
   *
   * @param ids - The root editor ids to delete (with their subtrees).
   * @example
   * ```ts
   * app["editor-bridge"].delete(enemyId);
   * ```
   */
  delete: (...ids: EditorId[]): void => {
    deleteSubtrees(buildAuthoringFacets(ctx), ids);
  },

  /**
   * Subtree-aware clone of the given objects — a gesture-bracketed burst of spawns, parents-first,
   * remapping each clone's `Node.parent`. ONE atomic undo entry; SELECTS the top-level clones.
   *
   * @param ids - The root editor ids to duplicate (with their subtrees).
   * @returns The top-level clone editor ids, in the same order as `ids`.
   * @example
   * ```ts
   * const [clone] = app["editor-bridge"].duplicate(enemyId);
   * ```
   */
  duplicate: (...ids: EditorId[]): readonly EditorId[] => {
    const clones = duplicateSubtrees(buildAuthoringFacets(ctx), ids);
    selectIds(ctx, clones);
    return clones;
  },

  /**
   * Re-parents `id` under `newParent` (`undefined` = scene root) — a gesture-bracketed burst of
   * `setField`s: (preserve-world, the default) the local `Transform` + `Node.parent` + `Node.order`.
   * Validated via `hierarchy.canReparent` before any write. ONE atomic undo entry.
   *
   * @param id - The node being reparented.
   * @param newParent - The candidate new parent, or `undefined` for the scene root.
   * @param opts - Reparent options (`mode`/`before`/`after`).
   * @returns The representative `CommandResult`, or `{ ok: false, error }` when the move is illegal.
   * @example
   * ```ts
   * app["editor-bridge"].reparent(grunt, undefined, { mode: "preserve-world" });
   * ```
   */
  reparent: (
    id: EditorId,
    newParent: EditorId | undefined,
    opts?: ReparentOptions
  ): CommandResult => reparentSubtrees(buildAuthoringFacets(ctx), id, newParent, opts),

  /**
   * Moves `id` between two siblings (`Node.order`, computed via `hierarchy.orderBetween`);
   * undo-tracked.
   *
   * @param id - The node being reordered.
   * @param before - The sibling the node should land BEFORE, or `undefined`.
   * @param after - The sibling the node should land AFTER, or `undefined`.
   * @example
   * ```ts
   * app["editor-bridge"].reorder(grunt, siblingA, siblingB);
   * ```
   */
  reorder: (id: EditorId, before: EditorId | undefined, after: EditorId | undefined): void => {
    const commands = ctx.require(commandsPlugin);
    const hierarchy = ctx.require(hierarchyPlugin);
    const entity = commands.resolve(id);
    const parent = entity === undefined ? undefined : hierarchy.parentOf(entity);

    ctx.require(editorHistoryPlugin).applyTracked({
      kind: "setField",
      id,
      component: "Node",
      field: "order",
      value: hierarchy.orderBetween(parent, before, after)
    });
  },

  /**
   * Renames `id` (`setField Node.name`); undo-tracked.
   *
   * @param id - The node being renamed.
   * @param name - The new display name.
   * @example
   * ```ts
   * app["editor-bridge"].rename(grunt, "Boss Grunt");
   * ```
   */
  rename: (id: EditorId, name: string): void => {
    ctx.require(editorHistoryPlugin).applyTracked({
      kind: "setField",
      id,
      component: "Node",
      field: "name",
      value: name
    });
  },

  /**
   * Toggles `id`'s active flag (`setField Node.enabled`); undo-tracked.
   *
   * @param id - The node whose active flag to set.
   * @param enabled - The new active flag.
   * @example
   * ```ts
   * app["editor-bridge"].setEnabled(grunt, false);
   * ```
   */
  setEnabled: (id: EditorId, enabled: boolean): void => {
    ctx.require(editorHistoryPlugin).applyTracked({
      kind: "setField",
      id,
      component: "Node",
      field: "enabled",
      value: enabled
    });
  },

  /**
   * Adds a named component, defaulted from `component-registry.get(component)?.defaults`;
   * undo-tracked.
   *
   * @param id - The target entity's stable editor id.
   * @param component - The component name to add.
   * @returns The {@link CommandResult} relayed from `editor-history`.
   * @example
   * ```ts
   * app["editor-bridge"].addComponent(grunt, "SpriteRenderer");
   * ```
   */
  addComponent: (id: EditorId, component: string): CommandResult => {
    const registry = ctx.require(componentRegistryPlugin);
    const value = registry.get(component)?.defaults ?? {};
    return ctx
      .require(editorHistoryPlugin)
      .applyTracked({ kind: "addComponent", id, component, value });
  },

  /**
   * Removes a named component; undo-tracked.
   *
   * @param id - The target entity's stable editor id.
   * @param component - The component name to remove.
   * @returns The {@link CommandResult} relayed from `editor-history`.
   * @example
   * ```ts
   * app["editor-bridge"].removeComponent(grunt, "SpriteRenderer");
   * ```
   */
  removeComponent: (id: EditorId, component: string): CommandResult =>
    ctx.require(editorHistoryPlugin).applyTracked({ kind: "removeComponent", id, component }),

  /**
   * The addable-component catalog enriched with each entry's field schema — for the
   * Add-Component picker. Fresh every call (the catalog is static + cheap; not epoch-gated).
   *
   * @returns The frozen catalog entries, each carrying its `reflection.describe` field schema.
   * @example
   * ```ts
   * for (const entry of app["editor-bridge"].listComponents()) addRow(entry);
   * ```
   */
  listComponents: (): readonly ComponentCatalogEntryWithFields[] => {
    const registry = ctx.require(componentRegistryPlugin);
    const reflection = ctx.require(reflectionPlugin);
    return Object.freeze(
      registry
        .list()
        .map(entry => Object.freeze({ ...entry, fields: reflection.describe(entry.name) }))
    );
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

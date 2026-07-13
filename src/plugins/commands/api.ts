/**
 * @file commands plugin — API factory.
 *
 * The single validated write-authority for editor ECS mutation. `apply` /
 * `applyRaw` share ONE internal validated mutator (`mutate`) that (1)
 * structurally validates the command, (2) runs the optional injected rich
 * validator, then (3) applies through the ECS command surface and updates
 * the two EditorId maps atomically. `restore` is the separate, non-undoable
 * bulk reseed. `resolve`/`editorIdOf` validate against `world.isAlive` and
 * prune stale mappings (the recycled-id corruption guard).
 */
import { ecsPlugin } from "../ecs";
import type { Entity, World } from "../ecs/types";
import type {
  Api,
  Command,
  CommandResult,
  Config,
  EditorId,
  Events,
  RawResult,
  RestoreEntity,
  RestoreSource,
  State
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Structural context type (only the fields the API factory accesses)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Structural context required by {@link createApi}, so unit tests can pass a
 * minimal mock without wiring the full kernel. Mirrors the platform/mcp
 * pattern for plugins that reach a dependency's API at call time rather than
 * capturing it in `onStart`.
 */
export type CommandsApiContext = {
  /** Resolved commands configuration (`maxIdWarn`). */
  readonly config: Readonly<Config>;
  /** commands plugin state — the two EditorId maps, mint counter, validator, warned latch. */
  readonly state: State;
  /** Logger from logPlugin (the maxIdWarn + unresolved-restore-name notices). */
  readonly log: {
    /** Log at debug level. */
    debug(message: string): void;
    /** Log at info level. */
    info(message: string): void;
    /** Log a warning. */
    warn(message: string): void;
    /** Log an error. */
    error(message: string): void;
  };
  /** Require the ecs plugin's World facade. Called per-method (no onStart to capture it in). */
  require: (plugin: typeof ecsPlugin) => World;
  /**
   * Emit a declared commands event with its typed payload. Written as a
   * method signature (bivariant params) so the kernel's merged `ctx.emit` is
   * assignable to this narrower commands-only view.
   *
   * @param event - The commands event name.
   * @param payload - The event payload, matching the declared shape.
   */
  emit<K extends keyof Events>(event: K, payload: Events[K]): void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * True when `value` is a non-null plain object — the structural guard for
 * `addComponent`/`spawn` component values. A type predicate: `true` narrows
 * `value` to `Record<string, unknown>`.
 *
 * @param value - The value to check.
 * @returns Whether `value` is a non-null object.
 * @example
 * ```ts
 * isPlainObject({ x: 1 }); // true
 * isPlainObject(null);     // false
 * ```
 */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Shallow-copy an arbitrary component value into a fresh, mutable plain
 * record before handing it to `world.add`/`world.set`/the injected
 * validator. A non-object value degrades to `{}` — the caller has already
 * structurally validated the value where that matters (`spawn`/`addComponent`);
 * `restore`'s reseed path relies on this same fallback to stay non-throwing.
 *
 * @param value - The raw component value.
 * @returns A fresh mutable `Record<string, unknown>`.
 * @example
 * ```ts
 * world.add(entity, token, toMutable(command.value));
 * ```
 */
const toMutable = (value: unknown): Record<string, unknown> =>
  isPlainObject(value) ? { ...value } : {};

/**
 * Join a rich validator's per-field errors into one human-readable message
 * for `CommandResult`/`RawResult`'s `error` string.
 *
 * @param errors - The rejected fields, each with a `key` and `message`.
 * @returns The joined error message.
 * @example
 * ```ts
 * joinErrors([{ key: "x", message: "must be finite" }]); // "must be finite"
 * ```
 */
const joinErrors = (errors: readonly { key: string; message: string }[]): string =>
  errors.map(errorEntry => errorEntry.message).join("; ");

/**
 * Build the RawResult failure for a command whose id does not resolve to a live entity.
 *
 * @param kind - The command kind, used in the error message.
 * @param id - The EditorId that failed to resolve.
 * @returns A `{ ok: false, error }` RawResult.
 * @example
 * ```ts
 * return unresolvedIdError("despawn", id);
 * ```
 */
const unresolvedIdError = (kind: string, id: EditorId): RawResult => ({
  ok: false,
  error: `[commands] ${kind}: EditorId ${id} does not resolve to a live entity.`
});

/**
 * Build the RawResult failure for a command naming an unknown component.
 *
 * @param kind - The command kind, used in the error message.
 * @param name - The component name that did not resolve via `world.componentByName`.
 * @returns A `{ ok: false, error }` RawResult.
 * @example
 * ```ts
 * return unknownComponentError("setField", "Nope");
 * ```
 */
const unknownComponentError = (kind: string, name: string): RawResult => ({
  ok: false,
  error: `[commands] ${kind}: unknown component "${name}".`
});

/**
 * Build the RawResult failure for a component value that is not a non-null object.
 *
 * @param kind - The command kind, used in the error message.
 * @param name - The component name whose value was invalid.
 * @returns A `{ ok: false, error }` RawResult.
 * @example
 * ```ts
 * return invalidValueError("spawn", "Position");
 * ```
 */
const invalidValueError = (kind: string, name: string): RawResult => ({
  ok: false,
  error: `[commands] ${kind}: component "${name}" value must be a non-null object.`
});

/**
 * Mint a fresh, monotonically increasing EditorId (never reused within a
 * session). Warns once via `ctx.log` when the live id-map count has already
 * crossed `config.maxIdWarn` (a possible entity leak). The lone EditorId
 * brand cast — every other file treats EditorId as fully opaque.
 *
 * @param ctx - The commands API context (state + config + log).
 * @returns A freshly minted EditorId.
 * @example
 * ```ts
 * const id = mintId(ctx); // 1, 2, 3, ... monotonically increasing
 * ```
 */
const mintId = (ctx: CommandsApiContext): EditorId => {
  const id = ctx.state.nextId++ as EditorId;
  const { maxIdWarn } = ctx.config;
  if (maxIdWarn > 0 && ctx.state.byEntity.size > maxIdWarn && !ctx.state.warned) {
    ctx.log.warn(
      `[commands] editor-id map exceeded maxIdWarn (${maxIdWarn}): possible entity leak.`
    );
    ctx.state.warned = true;
  }
  return id;
};

/**
 * Resolve an EditorId to its live Entity, pruning the id-map entry pair if
 * the mapped handle is no longer alive (the recycled-id corruption guard).
 * Shared by the public `resolve()` reader and every mutator's own pre-write
 * structural check.
 *
 * @param ctx - The commands API context (state).
 * @param world - The ECS world to check liveness against.
 * @param id - The EditorId to resolve.
 * @returns The live Entity, or `undefined` if unmapped / stale (pruned).
 * @example
 * ```ts
 * const entity = resolveLive(ctx, world, id);
 * if (entity === undefined) return unresolvedIdError("despawn", id);
 * ```
 */
const resolveLive = (ctx: CommandsApiContext, world: World, id: EditorId): Entity | undefined => {
  const entity = ctx.state.byId.get(id);
  if (entity === undefined) return undefined;
  if (!world.isAlive(entity)) {
    ctx.state.byId.delete(id);
    ctx.state.byEntity.delete(entity);
    return undefined;
  }
  return entity;
};

/**
 * Flatten `world.componentsOf` entries into a plain `Record<string, unknown>`
 * keyed by component name — the captured components for a despawn inverse.
 *
 * @param entries - The `{ name, value }` pairs from `world.componentsOf`.
 * @returns A record mapping each component name to its value.
 * @example
 * ```ts
 * componentsToRecord(world.componentsOf(entity)); // { Position: { x: 0, y: 0 } }
 * ```
 */
const componentsToRecord = (
  entries: ReadonlyArray<{ name: string; value: unknown }>
): Record<string, unknown> => {
  const record: Record<string, unknown> = {};
  for (const entry of entries) record[entry.name] = entry.value;
  return record;
};

// ─────────────────────────────────────────────────────────────────────────────
// mutate — the ONE validated mutator apply/applyRaw share
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate + apply a "spawn" command: every named component must resolve and be a plain object,
 * then spawn, add each component, mint (or re-bind) the EditorId, and write both id maps.
 *
 * @param ctx - The commands API context.
 * @param world - The ECS world.
 * @param command - The `spawn` command.
 * @returns `{ ok: true, id }` on success, else a `{ ok: false, error }` RawResult.
 * @example
 * ```ts
 * mutateSpawn(ctx, world, { kind: "spawn", components: { Position: { x: 0, y: 0 } } });
 * ```
 */
const mutateSpawn = (
  ctx: CommandsApiContext,
  world: World,
  command: Extract<Command, { kind: "spawn" }>
): RawResult => {
  const entries = Object.entries(command.components);

  for (const [name, value] of entries) {
    if (!world.componentByName(name)) return unknownComponentError("spawn", name);
    if (!isPlainObject(value)) return invalidValueError("spawn", name);
  }

  if (ctx.state.validate) {
    for (const [name, value] of entries) {
      const result = ctx.state.validate(name, toMutable(value));
      if (!result.ok) return { ok: false, error: joinErrors(result.errors) };
    }
  }

  const entity = world.spawn();
  for (const [name, value] of entries) {
    const componentToken = world.componentByName(name);
    if (componentToken) world.add(entity, componentToken, toMutable(value));
  }

  const id = command.id ?? mintId(ctx);
  ctx.state.byId.set(id, entity);
  ctx.state.byEntity.set(entity, id);
  return { ok: true, id };
};

/**
 * Validate + apply a "despawn" command: the id must resolve to a live entity, then despawn it
 * and delete both id-map entries in the same synchronous step.
 *
 * @param ctx - The commands API context.
 * @param world - The ECS world.
 * @param command - The `despawn` command.
 * @returns `{ ok: true, id }` on success, else a `{ ok: false, error }` RawResult.
 * @example
 * ```ts
 * mutateDespawn(ctx, world, { kind: "despawn", id });
 * ```
 */
const mutateDespawn = (
  ctx: CommandsApiContext,
  world: World,
  command: Extract<Command, { kind: "despawn" }>
): RawResult => {
  const entity = resolveLive(ctx, world, command.id);
  if (entity === undefined) return unresolvedIdError("despawn", command.id);

  world.despawn(entity);
  ctx.state.byId.delete(command.id);
  ctx.state.byEntity.delete(entity);
  return { ok: true, id: command.id };
};

/**
 * Validate + apply a "setField" command: id + component must resolve, `field` must be a non-empty
 * string, the optional rich validator must accept, then merge the field into the component value.
 *
 * @param ctx - The commands API context.
 * @param world - The ECS world.
 * @param command - The `setField` command.
 * @returns `{ ok: true, id }` on success, else a `{ ok: false, error }` RawResult.
 * @example
 * ```ts
 * mutateSetField(ctx, world, { kind: "setField", id, component: "Position", field: "x", value: 5 });
 * ```
 */
const mutateSetField = (
  ctx: CommandsApiContext,
  world: World,
  command: Extract<Command, { kind: "setField" }>
): RawResult => {
  const entity = resolveLive(ctx, world, command.id);
  if (entity === undefined) return unresolvedIdError("setField", command.id);

  const componentToken = world.componentByName(command.component);
  if (!componentToken) return unknownComponentError("setField", command.component);

  if (typeof command.field !== "string" || command.field.length === 0) {
    return { ok: false, error: '[commands] setField: "field" must be a non-empty string.' };
  }

  if (ctx.state.validate) {
    const result = ctx.state.validate(command.component, { [command.field]: command.value });
    if (!result.ok) return { ok: false, error: joinErrors(result.errors) };
  }

  world.set(entity, componentToken, { [command.field]: command.value });
  return { ok: true, id: command.id };
};

/**
 * Validate + apply an "addComponent" command: id + component must resolve, any provided value must
 * be a plain object, the optional rich validator must accept, then add the component to the entity.
 *
 * @param ctx - The commands API context.
 * @param world - The ECS world.
 * @param command - The `addComponent` command.
 * @returns `{ ok: true, id }` on success, else a `{ ok: false, error }` RawResult.
 * @example
 * ```ts
 * mutateAddComponent(ctx, world, { kind: "addComponent", id, component: "Velocity", value: { dx: 1 } });
 * ```
 */
const mutateAddComponent = (
  ctx: CommandsApiContext,
  world: World,
  command: Extract<Command, { kind: "addComponent" }>
): RawResult => {
  const entity = resolveLive(ctx, world, command.id);
  if (entity === undefined) return unresolvedIdError("addComponent", command.id);

  const componentToken = world.componentByName(command.component);
  if (!componentToken) return unknownComponentError("addComponent", command.component);

  if (command.value !== undefined && !isPlainObject(command.value)) {
    return invalidValueError("addComponent", command.component);
  }

  if (ctx.state.validate) {
    const result = ctx.state.validate(command.component, toMutable(command.value));
    if (!result.ok) return { ok: false, error: joinErrors(result.errors) };
  }

  world.add(
    entity,
    componentToken,
    command.value === undefined ? undefined : toMutable(command.value)
  );
  return { ok: true, id: command.id };
};

/**
 * Validate + apply a "removeComponent" command: id + component must resolve, then remove it.
 *
 * @param ctx - The commands API context.
 * @param world - The ECS world.
 * @param command - The `removeComponent` command.
 * @returns `{ ok: true, id }` on success, else a `{ ok: false, error }` RawResult.
 * @example
 * ```ts
 * mutateRemoveComponent(ctx, world, { kind: "removeComponent", id, component: "Velocity" });
 * ```
 */
const mutateRemoveComponent = (
  ctx: CommandsApiContext,
  world: World,
  command: Extract<Command, { kind: "removeComponent" }>
): RawResult => {
  const entity = resolveLive(ctx, world, command.id);
  if (entity === undefined) return unresolvedIdError("removeComponent", command.id);

  const componentToken = world.componentByName(command.component);
  if (!componentToken) return unknownComponentError("removeComponent", command.component);

  world.remove(entity, componentToken);
  return { ok: true, id: command.id };
};

/**
 * The ONE internal validated mutator both `apply` and `applyRaw` share:
 * structural validation, then the optional injected rich validator, then the
 * ECS write + atomic EditorId map update — dispatched per `Command.kind`.
 *
 * @param ctx - The commands API context.
 * @param world - The ECS world (obtained once per public call via `ctx.require`).
 * @param command - The command to validate and apply.
 * @returns `{ ok: true, id }` on success, `{ ok: false, error }` on validation failure.
 * @example
 * ```ts
 * const result = mutate(ctx, world, { kind: "despawn", id });
 * ```
 */
const mutate = (ctx: CommandsApiContext, world: World, command: Command): RawResult => {
  switch (command.kind) {
    case "spawn": {
      return mutateSpawn(ctx, world, command);
    }
    case "despawn": {
      return mutateDespawn(ctx, world, command);
    }
    case "setField": {
      return mutateSetField(ctx, world, command);
    }
    case "addComponent": {
      return mutateAddComponent(ctx, world, command);
    }
    case "removeComponent": {
      return mutateRemoveComponent(ctx, world, command);
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// apply — mutate() + inverse assembly
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read a setField target's pre-write field value (for the `apply` inverse), tolerating an
 * unresolved id/component by returning `undefined`.
 *
 * @param ctx - The commands API context.
 * @param world - The ECS world.
 * @param command - The `setField` command being applied.
 * @returns The current field value before the write, or `undefined`.
 * @example
 * ```ts
 * const old = readFieldBeforeWrite(ctx, world, command);
 * ```
 */
const readFieldBeforeWrite = (
  ctx: CommandsApiContext,
  world: World,
  command: Extract<Command, { kind: "setField" }>
): unknown => {
  const entity = resolveLive(ctx, world, command.id);
  if (entity === undefined) return undefined;
  const componentToken = world.componentByName(command.component);
  if (!componentToken) return undefined;
  return world.get(entity, componentToken)?.[command.field];
};

/**
 * Read a removeComponent target's pre-write component value (for the `apply` inverse), tolerating an
 * unresolved id/component by returning `undefined`.
 *
 * @param ctx - The commands API context.
 * @param world - The ECS world.
 * @param command - The `removeComponent` command being applied.
 * @returns The current component value before the write, or `undefined`.
 * @example
 * ```ts
 * const old = readComponentBeforeWrite(ctx, world, command);
 * ```
 */
const readComponentBeforeWrite = (
  ctx: CommandsApiContext,
  world: World,
  command: Extract<Command, { kind: "removeComponent" }>
): Record<string, unknown> | undefined => {
  const entity = resolveLive(ctx, world, command.id);
  if (entity === undefined) return undefined;
  const componentToken = world.componentByName(command.component);
  if (!componentToken) return undefined;
  return world.get(entity, componentToken);
};

/**
 * Validate + apply a command, capturing the inverse-relevant pre-state
 * before mutating and assembling the exact inverse command on success. On
 * `mutate` failure, returns `{ ok: false, error }` unchanged — no inverse.
 *
 * @param ctx - The commands API context.
 * @param command - The command to apply.
 * @returns The {@link CommandResult}.
 * @example
 * ```ts
 * const result = apply(ctx, { kind: "spawn", components: { Position: { x: 0, y: 0 } } });
 * ```
 */
const apply = (ctx: CommandsApiContext, command: Command): CommandResult => {
  const world = ctx.require(ecsPlugin);

  switch (command.kind) {
    case "spawn": {
      const result = mutateSpawn(ctx, world, command);
      if (!result.ok) return result;
      return { ok: true, inverse: { kind: "despawn", id: result.id } };
    }
    case "despawn": {
      const entity = resolveLive(ctx, world, command.id);
      const captured = entity === undefined ? [] : world.componentsOf(entity);
      const result = mutateDespawn(ctx, world, command);
      if (!result.ok) return result;
      return {
        ok: true,
        inverse: { kind: "spawn", components: componentsToRecord(captured), id: command.id }
      };
    }
    case "setField": {
      const oldValue = readFieldBeforeWrite(ctx, world, command);
      const result = mutateSetField(ctx, world, command);
      if (!result.ok) return result;
      return {
        ok: true,
        inverse: {
          kind: "setField",
          id: command.id,
          component: command.component,
          field: command.field,
          value: oldValue
        }
      };
    }
    case "addComponent": {
      const result = mutateAddComponent(ctx, world, command);
      if (!result.ok) return result;
      return {
        ok: true,
        inverse: { kind: "removeComponent", id: command.id, component: command.component }
      };
    }
    case "removeComponent": {
      const oldValue = readComponentBeforeWrite(ctx, world, command);
      const result = mutateRemoveComponent(ctx, world, command);
      if (!result.ok) return result;
      return {
        ok: true,
        inverse:
          oldValue === undefined
            ? { kind: "addComponent", id: command.id, component: command.component }
            : {
                kind: "addComponent",
                id: command.id,
                component: command.component,
                value: oldValue
              }
      };
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// restore — the non-undoable bulk reseed
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Non-undoable bulk reseed: despawn every editor-owned entity, respawn from
 * `entities` re-binding each saved EditorId, advance `nextId` past the
 * highest restored id, and emit the coarse `commands:restored` milestone.
 *
 * @param ctx - The commands API context.
 * @param entities - The saved entities to reseed the world from.
 * @param source - Which reseed triggered this restore.
 * @example
 * ```ts
 * restore(ctx, doc.entities, "reload");
 * ```
 */
const restore = (
  ctx: CommandsApiContext,
  entities: readonly RestoreEntity[],
  source: RestoreSource
): void => {
  const world = ctx.require(ecsPlugin);

  for (const entity of ctx.state.byEntity.keys()) world.despawn(entity);
  ctx.state.byId.clear();
  ctx.state.byEntity.clear();

  let maxRestoredId = 0;
  for (const restoreEntity of entities) {
    const entity = world.spawn();
    for (const [name, value] of Object.entries(restoreEntity.components)) {
      const componentToken = world.componentByName(name);
      if (!componentToken) {
        ctx.log.warn(`[commands] restore: component "${name}" no longer resolves — skipped.`);
        continue;
      }
      world.add(entity, componentToken, toMutable(value));
    }
    ctx.state.byId.set(restoreEntity.id, entity);
    ctx.state.byEntity.set(entity, restoreEntity.id);
    if (restoreEntity.id > maxRestoredId) maxRestoredId = restoreEntity.id;
  }

  ctx.state.nextId = Math.max(ctx.state.nextId, maxRestoredId + 1);
  ctx.emit("commands:restored", { source });
};

// ─────────────────────────────────────────────────────────────────────────────
// API factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates the commands plugin API surface.
 *
 * @param ctx - Plugin context (structural — only the fields this API uses).
 * @returns The commands plugin {@link Api} object.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * const result = api.apply({ kind: "spawn", components: { Position: { x: 0, y: 0 } } });
 * ```
 */
export const createApi = (ctx: CommandsApiContext): Api => ({
  /**
   * Validate + apply a command, returning the INVERSE on success (for one-shot revertable callers).
   *
   * @param command - The command to validate and apply.
   * @returns The {@link CommandResult} — `{ ok: true, inverse }` or `{ ok: false, error }`.
   * @example
   * ```ts
   * const result = app.commands.apply({ kind: "setField", id, component: "Position", field: "x", value: 5 });
   * if (result.ok) history.push(result.inverse);
   * ```
   */
  apply: (command: Command): CommandResult => apply(ctx, command),

  /**
   * Validate + apply a command WITHOUT computing an inverse (the primitive `editor-history` wraps).
   *
   * @param command - The command to validate and apply.
   * @returns The {@link RawResult} — `{ ok: true, id }` or `{ ok: false, error }`.
   * @example
   * ```ts
   * const result = app.commands.applyRaw({ kind: "despawn", id });
   * ```
   */
  applyRaw: (command: Command): RawResult => mutate(ctx, ctx.require(ecsPlugin), command),

  /**
   * Non-undoable bulk reseed: clear editor-owned entities, respawn re-binding saved ids, and emit
   * `commands:restored`. Used by scene load and exit-play revert.
   *
   * @param entities - The saved entities to reseed the world from.
   * @param source - Which reseed triggered this restore (`"reload"` | `"exit-play"`).
   * @example
   * ```ts
   * app.commands.restore(doc.entities, "reload");
   * ```
   */
  restore: (entities: readonly RestoreEntity[], source: RestoreSource): void => {
    restore(ctx, entities, source);
  },

  /**
   * Resolve an EditorId to its live Entity, validating against `world.isAlive` and pruning a stale
   * mapping (the recycled-id guard). Returns `undefined` if retired or recycled.
   *
   * @param id - The EditorId to resolve.
   * @returns The live Entity, or `undefined`.
   * @example
   * ```ts
   * const entity = app.commands.resolve(id);
   * ```
   */
  resolve: (id: EditorId): Entity | undefined => resolveLive(ctx, ctx.require(ecsPlugin), id),

  /**
   * The stable EditorId for a live Entity, or `undefined` if it is not editor-owned / not alive.
   *
   * @param entity - The Entity to look up.
   * @returns The EditorId, or `undefined`.
   * @example
   * ```ts
   * const id = app.commands.editorIdOf(entity);
   * ```
   */
  editorIdOf: (entity: Entity): EditorId | undefined => {
    const world = ctx.require(ecsPlugin);
    return world.isAlive(entity) ? ctx.state.byEntity.get(entity) : undefined;
  },

  /**
   * Inject the optional rich field validator (the reflection decoupling seam); pass `undefined` to
   * clear it back to structural-only validation.
   *
   * @param validate - The rich field validator, or `undefined` to clear.
   * @example
   * ```ts
   * app.commands.setValidator(app.reflection.validate);
   * ```
   */
  setValidator: (validate): void => {
    ctx.state.validate = validate;
  },

  /**
   * The number of live editor-owned entities (the EditorId map size).
   *
   * @returns The count of editor-owned entities.
   * @example
   * ```ts
   * app.commands.count(); // 0 before any spawn
   * ```
   */
  count: (): number => ctx.state.byEntity.size
});

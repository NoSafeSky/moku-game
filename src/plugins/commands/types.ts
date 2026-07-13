/**
 * @file commands plugin — public type surface (Config, State, Command union, EditorId, Api, Events).
 */
import type { Entity } from "../ecs/types";

/**
 * commands plugin configuration — defaults applied when a consumer omits a field.
 */
export type Config = {
  /**
   * Soft ceiling on the number of live editor-owned entities (the EditorId map size).
   * Crossing it logs a one-time `ctx.log.warn` — a leak / runaway-spawn smell, not an error.
   * `0` disables the check.
   *
   * @default 100000
   */
  maxIdWarn: number;
};

/**
 * Stable, save-durable editor id for an entity. Branded so it is NOT interchangeable
 * with a plain number or with an ECS `Entity` (which is generational and recycles).
 * Minted by `commands` on spawn; the external handle serialization / undo / selection key on.
 */
export type EditorId = number & { readonly __editorId: unique symbol };

/**
 * A serializable, discriminated-union editor mutation — the ONLY thing `apply`/`applyRaw` accept.
 * Components are addressed by NAME (ties to reflection + serialization); values are plain data.
 */
export type Command =
  /** Create an entity from named components. `id` is set ONLY by an inverse (undo of a despawn), to re-bind the original EditorId; a user spawn omits it and a fresh id is minted. */
  | { kind: "spawn"; components: Readonly<Record<string, unknown>>; id?: EditorId }
  /** Destroy the entity with this EditorId. */
  | { kind: "despawn"; id: EditorId }
  /** Set one field of one named component (the inspector's per-field edit). */
  | { kind: "setField"; id: EditorId; component: string; field: string; value: unknown }
  /** Add a named component (optionally with an initial partial value). */
  | {
      kind: "addComponent";
      id: EditorId;
      component: string;
      value?: Readonly<Record<string, unknown>>;
    }
  /** Remove a named component. */
  | { kind: "removeComponent"; id: EditorId; component: string };

/** Outcome of `apply` — carries the INVERSE command (what undoes it) on success. */
export type CommandResult = { ok: true; inverse: Command } | { ok: false; error: string };

/** Outcome of `applyRaw` — the primitive; carries the AFFECTED EditorId, no inverse. */
export type RawResult = { ok: true; id: EditorId } | { ok: false; error: string };

/** Non-undoable reseed source — becomes the `commands:restored` payload. */
export type RestoreSource = "reload" | "exit-play";

/**
 * One entity in a bulk `restore`. Structurally identical to serialization's `SceneEntity`,
 * so `serialization` passes `doc.entities` straight in WITHOUT commands importing its types.
 */
export type RestoreEntity = {
  /** The saved stable id to re-bind. */
  readonly id: EditorId;
  /** Named components → their values. */
  readonly components: Readonly<Record<string, unknown>>;
};

/**
 * Result of a rich field validation — structurally identical to `reflection.validate`'s return
 * (one `{ key, message }` per offending field) so `commands.setValidator(reflection.validate)`
 * wires with NO adapter. `commands` defines the shape itself; it imports no `reflection` type.
 */
export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: readonly { key: string; message: string }[] };

/**
 * Injected rich validator. `commands` defines the shape; whoever HAS `reflection`
 * wires `commands.setValidator(reflection.validate)`. Keeps commands → reflection decoupled.
 */
export type FieldValidator = (
  component: string,
  partial: Readonly<Record<string, unknown>>
) => ValidationResult;

/**
 * commands plugin state — the two EditorId maps, the mint counter, and the optional
 * injected rich validator. All live in-memory; there is no external resource.
 */
export type State = {
  /** Forward map: stable EditorId → the current live ECS Entity handle. */
  readonly byId: Map<EditorId, Entity>;
  /**
   * Reverse map: live Entity → its EditorId. Its key set IS the "editor-owned" set —
   * `restore` clears exactly these entities, and `count()` returns its size.
   */
  readonly byEntity: Map<Entity, EditorId>;
  /** Next EditorId to mint; monotonically increasing, never reused within a session (starts at 1). */
  nextId: number;
  /**
   * Optional rich field validator injected via `setValidator` (wired to `reflection.validate`
   * by editor-bridge/serialization). `undefined` → structural validation only.
   */
  validate: FieldValidator | undefined;
  /** Set true once `maxIdWarn` has been crossed, so the warning fires at most once. */
  warned: boolean;
};

/** Public API surface (`app.commands`). */
export type Api = {
  /** Validate + apply a command, returning the INVERSE on success (for one-shot revertable callers). */
  apply(command: Command): CommandResult;
  /** Validate + apply a command WITHOUT computing an inverse (the primitive `editor-history` wraps). */
  applyRaw(command: Command): RawResult;
  /** Non-undoable bulk reseed: clear editor-owned entities, respawn re-binding ids, emit `commands:restored`. */
  restore(entities: readonly RestoreEntity[], source: RestoreSource): void;
  /** Resolve an EditorId to its live Entity, validating against `world.isAlive` (prunes stale). `undefined` if retired/recycled. */
  resolve(id: EditorId): Entity | undefined;
  /** The stable EditorId for a live Entity, or `undefined` if it is not editor-owned / not alive. */
  editorIdOf(entity: Entity): EditorId | undefined;
  /** Inject the optional rich field validator (the reflection decoupling seam); pass `undefined` to clear. */
  setValidator(validate: FieldValidator | undefined): void;
  /** Number of live editor-owned entities (the EditorId map size). */
  count(): number;
};

/**
 * commands plugin events (plugin-level, declared via `register.map<Events>`).
 */
export type Events = {
  /**
   * Emitted after a non-undoable `restore()` reseeds the world + EditorId map.
   * `source` distinguishes a scene reload from an exit-play revert. Coarse — scene-load /
   * exit-play frequency, NOT a per-command RPC.
   */
  "commands:restored": { source: RestoreSource };
};

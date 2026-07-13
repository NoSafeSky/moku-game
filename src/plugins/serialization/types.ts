/**
 * @file serialization plugin — public type surface (Config, State, SceneDocument/SceneEntity, Api, Events).
 */
import type { EditorId } from "../commands/types";
import type { Migration } from "../storage/types";

/**
 * serialization plugin configuration — defaults applied when a consumer omits a field.
 */
export type Config = {
  /**
   * Sub-prefix (WITHIN the `storage` plugin's own namespace) under which every scene is
   * persisted, as `${storageKeyPrefix}${name}`. Lets `save`/`load`/`list` share one storage
   * namespace with other save data without collision.
   *
   * @default "scene:"
   */
  storageKeyPrefix: string;
  /**
   * Current scene-schema version. `serialize`/`save` stamp a document at this version; on
   * `load`/`import` a document below it is upgraded through `migrations` up to this number.
   *
   * @default 1
   */
  version: number;
  /**
   * Migration chain: target-version → transform of the whole `SceneDocument` snapshot.
   * `migrations[n]` upgrades a `v(n-1)` document to `vn`. Reuses `storage`'s `Migration`
   * contract (`(Snapshot) => Snapshot`).
   *
   * @default {}
   */
  migrations: Readonly<Record<number, Migration>>;
};

/**
 * One entity in a serialized scene: its stable save-durable `EditorId` and its NAMED
 * components as plain data (`componentName → value`). Structurally compatible with
 * `commands`' `RestoreEntity`, so `deserialize` passes `doc.entities` straight to
 * `commands.restore` WITHOUT any adapter.
 */
export type SceneEntity = {
  /** The stable editor id `commands` minted for this entity; re-bound on restore. */
  id: EditorId;
  /** Named components → their captured plain-data values. */
  components: Record<string, unknown>;
};

/**
 * A versioned, save-durable capture of the editor-owned ECS world. `version` drives the
 * migration chain on load; `name` labels the save slot; `entities` is the ordered list of
 * editor-owned entities (each keyed by `EditorId`, NAMED components only).
 */
export type SceneDocument = {
  /** Scene-schema version — `config.version` at write time; migrated up on load if behind. */
  version: number;
  /** The scene's save-slot name (`storage` key suffix; `"untitled"` for an unnamed serialize). */
  name: string;
  /** The editor-owned entities, in `world.liveEntities()` order. */
  entities: SceneEntity[];
};

/**
 * serialization plugin state — the name/version of the last (de)serialized or saved scene.
 * Purely in-memory bookkeeping; there is no external resource (persistence lives in `storage`).
 */
export type State = {
  /**
   * Name of the most recently saved / loaded / deserialized scene, stamped into the next
   * `serialize()` document's `name`. `undefined` until the first save/load — a fresh
   * `serialize()` then falls back to `"untitled"`.
   */
  currentName: string | undefined;
  /**
   * Version of the scene currently live in the world (seeded from `config.version`; after a
   * `load`/`import` of a migrated document it equals `config.version`, the post-upgrade version).
   */
  currentVersion: number;
};

/** Public API surface (`app.serialization`). */
export type Api = {
  /** Capture the live editor-owned ECS world as a versioned `SceneDocument` (named components only). */
  serialize(): SceneDocument;
  /** Atomically reseed the world from a document: migrate → validate → `commands.restore` → emit `serialization:loaded`. */
  deserialize(doc: SceneDocument): void;
  /** Serialize + persist under `${storageKeyPrefix}${name}` via `storage`. Returns `storage`'s success flag; never throws. */
  save(name: string): boolean;
  /** Load + deserialize the scene saved under `name`. Returns `false` if absent (no world change); never throws. */
  load(name: string): boolean;
  /** The names of every saved scene in this prefix (the `storageKeyPrefix` stripped). Never throws. */
  list(): string[];
  /** Serialize the live world to a JSON string (clipboard / file / AI hand-off) — the storage-free export. */
  export(): string;
  /** Parse a JSON scene string and deserialize it (migrate + validate + restore). Aborts, logging, on malformed/invalid input. */
  import(json: string): void;
};

/**
 * serialization plugin events (plugin-level, declared via `register.map<Events>`).
 */
export type Events = {
  /**
   * Emitted after a `SceneDocument` has been deserialized into the world (via `deserialize`,
   * `load`, or `import`). Coarse — scene-load frequency, NOT a per-entity RPC. `name` is the
   * scene label; `entityCount` is how many entities were reseeded.
   */
  "serialization:loaded": { name: string; entityCount: number };
};

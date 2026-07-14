/**
 * @file serialization plugin — API factory.
 *
 * Orchestrates the four dependency edges (`ecs`, `storage`, `commands`, `reflection`), each
 * resolved via `ctx.require` at call time (no `onStart` capture — scene operations are
 * user-gesture frequency, not per-frame). The actual capture/shape helpers live in `document.ts`;
 * the on-load version upgrade lives in `migrate.ts`. This file is pure orchestration: `migrate →
 * validate → restore → emit` for a load, and thin wrapping for `save`/`load`/`list`/`export`.
 */
import { commandsPlugin } from "../commands";
import type { Api as CommandsApi } from "../commands/types";
import { ecsPlugin } from "../ecs";
import type { World } from "../ecs/types";
import { reflectionPlugin } from "../reflection";
import type { Api as ReflectionApi } from "../reflection/types";
import { storagePlugin } from "../storage";
import type { Api as StorageApi } from "../storage/types";
import { captureEntities, isSceneDocumentShape, toRecord } from "./document";
import type { Log } from "./migrate";
import { upgradeDocument } from "./migrate";
import type { Api, Config, Events, SceneDocument, State } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Structural context type (only the fields the API factory accesses)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every dependency `serialization` reaches via `ctx.require`, one call signature per plugin
 * instance — the `platform`/`commands` intersection pattern for a plugin with several `require`d
 * dependencies resolved at call time rather than captured in `onStart`.
 */
export type SerializationRequire = ((plugin: typeof ecsPlugin) => World) &
  ((plugin: typeof storagePlugin) => StorageApi) &
  ((plugin: typeof commandsPlugin) => CommandsApi) &
  ((plugin: typeof reflectionPlugin) => ReflectionApi);

/**
 * Structural context required by {@link createApi}, so unit tests can pass a minimal mock
 * without wiring the full kernel. Mirrors the `commands`/`platform` pattern for a plugin that
 * reaches its dependencies at call time via `require`, rather than capturing them in `onStart`.
 */
export type SerializationApiContext = {
  /** Resolved serialization configuration (`storageKeyPrefix`/`version`/`migrations`). */
  readonly config: Readonly<Config>;
  /** serialization plugin state (`currentName`/`currentVersion`). */
  readonly state: State;
  /** Logger from `logPlugin` (the downgrade / rejected-scene / malformed-JSON notices). */
  readonly log: Log;
  /** Require a dependency's API by plugin instance, resolved at call time. */
  readonly require: SerializationRequire;
  /**
   * Emit a declared serialization event with its typed payload. Written as a method signature
   * (bivariant params) so the kernel's merged `ctx.emit` is assignable to this narrower
   * serialization-only view when the API factory is wired via `api: ctx => createApi(ctx)`.
   *
   * @param event - The serialization event name.
   * @param payload - The event payload, matching the declared shape.
   */
  emit<K extends keyof Events>(event: K, payload: Events[K]): void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Joins a rejected `reflection.validate` result's per-field errors into one human-readable
 * string for the rejected-scene warning.
 *
 * @param errors - The rejected fields, each with a `key` and `message`.
 * @returns The joined error message.
 * @example
 * ```ts
 * joinErrors([{ key: "hp", message: "above maximum 100" }]); // "hp: above maximum 100"
 * ```
 */
const joinErrors = (errors: readonly { key: string; message: string }[]): string =>
  errors.map(error => `${error.key}: ${error.message}`).join("; ");

/**
 * Captures the live editor-owned ECS world as a versioned `SceneDocument` (named components
 * only, keyed by `EditorId`).
 *
 * @param ctx - The serialization API context.
 * @returns The captured {@link SceneDocument}.
 * @example
 * ```ts
 * const doc = serialize(ctx); // { version: 1, name: "untitled", entities: [...] }
 * ```
 */
const serialize = (ctx: SerializationApiContext): SceneDocument => {
  const world = ctx.require(ecsPlugin);
  const commands = ctx.require(commandsPlugin);
  return {
    version: ctx.config.version,
    name: ctx.state.currentName ?? "untitled",
    entities: captureEntities(world, commands)
  };
};

/**
 * Atomically reseeds the world from a document: migrate → validate every component → one
 * `commands.restore` → emit `serialization:loaded`. Aborts on the first `reflection.validate`
 * rejection, leaving the world untouched (guard order: validation runs entirely before the
 * restore call).
 *
 * @param ctx - The serialization API context.
 * @param doc - The document to deserialize into the world.
 * @example
 * ```ts
 * deserialize(ctx, doc);
 * ```
 */
const deserialize = (ctx: SerializationApiContext, doc: SceneDocument): void => {
  const upgraded = upgradeDocument(doc, ctx.config.version, ctx.config.migrations, ctx.log);
  const reflection = ctx.require(reflectionPlugin);

  for (const entity of upgraded.entities) {
    for (const [name, value] of Object.entries(entity.components)) {
      const result = reflection.validate(name, toRecord(value));
      if (!result.ok) {
        ctx.log.warn(
          `[serialization] scene '${upgraded.name}' rejected: ${name} ${joinErrors(result.errors)} — world unchanged.`
        );
        return;
      }
    }
  }

  ctx.require(commandsPlugin).restore(upgraded.entities, "reload");
  ctx.state.currentName = upgraded.name;
  ctx.state.currentVersion = upgraded.version;
  ctx.emit("serialization:loaded", { name: upgraded.name, entityCount: upgraded.entities.length });
};

/**
 * Serializes the live world and persists it as JSON under `${storageKeyPrefix}${name}` via
 * `storage`. Never throws — propagates `storage.set`'s boolean.
 *
 * @param ctx - The serialization API context.
 * @param name - The save-slot name.
 * @returns `true` on a successful write, else `false`.
 * @example
 * ```ts
 * save(ctx, "level1");
 * ```
 */
const save = (ctx: SerializationApiContext, name: string): boolean => {
  const doc: SceneDocument = { ...serialize(ctx), name };
  const ok = ctx.require(storagePlugin).set(ctx.config.storageKeyPrefix + name, doc);
  if (ok) ctx.state.currentName = name;
  return ok;
};

/**
 * Reads + deserializes the scene saved under `name`. Never throws — a missing key returns
 * `false` with no world change.
 *
 * @param ctx - The serialization API context.
 * @param name - The save-slot name.
 * @returns `true` if a document was found and deserialized, else `false`.
 * @example
 * ```ts
 * load(ctx, "level1");
 * ```
 */
const load = (ctx: SerializationApiContext, name: string): boolean => {
  const doc = ctx.require(storagePlugin).get<SceneDocument>(ctx.config.storageKeyPrefix + name);
  if (doc === undefined) return false;

  deserialize(ctx, doc);
  return true;
};

/**
 * Lists the names of every saved scene under this plugin's `storageKeyPrefix`, the prefix
 * stripped. Never throws.
 *
 * @param ctx - The serialization API context.
 * @returns The saved scene names.
 * @example
 * ```ts
 * list(ctx); // → ["level1", "level2"]
 * ```
 */
const list = (ctx: SerializationApiContext): string[] => {
  const prefix = ctx.config.storageKeyPrefix;
  return ctx
    .require(storagePlugin)
    .keys()
    .filter(key => key.startsWith(prefix))
    .map(key => key.slice(prefix.length));
};

/**
 * Parses a JSON scene string and deserializes it (migrate + validate + restore). Aborts, logging
 * a warning, on malformed JSON or an invalid document shape — no world change either way.
 *
 * @param ctx - The serialization API context.
 * @param json - The JSON scene string to import.
 * @example
 * ```ts
 * importJson(ctx, app.serialization.export());
 * ```
 */
const importJson = (ctx: SerializationApiContext, json: string): void => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    ctx.log.warn("[serialization] import: malformed JSON — ignored.");
    return;
  }

  if (!isSceneDocumentShape(parsed)) {
    ctx.log.warn("[serialization] import: invalid scene shape — ignored.");
    return;
  }

  deserialize(ctx, parsed);
};

// ─────────────────────────────────────────────────────────────────────────────
// API factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates the serialization plugin API surface.
 *
 * @param ctx - Plugin context (structural — only the fields this API uses).
 * @returns The serialization plugin {@link Api} object.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * api.save("level1");
 * ```
 */
export const createApi = (ctx: SerializationApiContext): Api => ({
  /**
   * Captures the live editor-owned ECS world as a versioned `SceneDocument` (named components
   * only).
   *
   * @returns The captured {@link SceneDocument}.
   * @example
   * ```ts
   * app.serialization.serialize();
   * ```
   */
  serialize: (): SceneDocument => serialize(ctx),

  /**
   * Atomically reseeds the world from a document: migrate → validate → `commands.restore` →
   * emit `serialization:loaded`.
   *
   * @param doc - The document to deserialize into the world.
   * @example
   * ```ts
   * app.serialization.deserialize(doc);
   * ```
   */
  deserialize: (doc: SceneDocument): void => {
    deserialize(ctx, doc);
  },

  /**
   * Serializes + persists the live world under `${storageKeyPrefix}${name}` via `storage`.
   *
   * @param name - The save-slot name.
   * @returns `storage`'s success flag; never throws.
   * @example
   * ```ts
   * app.serialization.save("level1");
   * ```
   */
  save: (name: string): boolean => save(ctx, name),

  /**
   * Loads + deserializes the scene saved under `name`.
   *
   * @param name - The save-slot name.
   * @returns `false` if absent (no world change); never throws.
   * @example
   * ```ts
   * app.serialization.load("level1");
   * ```
   */
  load: (name: string): boolean => load(ctx, name),

  /**
   * The names of every saved scene in this prefix (the `storageKeyPrefix` stripped).
   *
   * @returns The saved scene names; never throws.
   * @example
   * ```ts
   * app.serialization.list(); // ["level1", "level2"]
   * ```
   */
  list: (): string[] => list(ctx),

  /**
   * Serializes the live world to a JSON string (clipboard / file / AI hand-off) — the
   * storage-free export.
   *
   * @returns The JSON-encoded {@link SceneDocument}.
   * @example
   * ```ts
   * const json = app.serialization.export();
   * ```
   */
  export: (): string => JSON.stringify(serialize(ctx)),

  /**
   * Parses a JSON scene string and deserializes it (migrate + validate + restore). Aborts,
   * logging, on malformed/invalid input.
   *
   * @param json - The JSON scene string to import.
   * @example
   * ```ts
   * app.serialization.import(json);
   * ```
   */
  import: (json: string): void => {
    importJson(ctx, json);
  }
});

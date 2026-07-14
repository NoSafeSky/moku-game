/**
 * @file serialization plugin — pure ECS ↔ document capture and shape helpers (internal).
 *
 * `captureEntities` is `serialize()`'s inner walk (world → plain-data `SceneEntity[]`); the
 * remaining helpers support `deserialize`'s validation gate and `import`'s shape guard. Pure —
 * no I/O, no `ctx.require`, no mutation of anything passed in.
 */
import type { Api as CommandsApi } from "../commands/types";
import type { World } from "../ecs/types";
import type { SceneDocument, SceneEntity } from "./types";

/** The slice of `World` `captureEntities` reads — narrowed for easy unit-test mocking. */
export type CaptureWorld = Pick<World, "liveEntities" | "componentsOf">;

/** The slice of the `commands` API `captureEntities` reads — narrowed for easy unit-test mocking. */
export type CaptureCommands = Pick<CommandsApi, "editorIdOf">;

/**
 * True when `value` is a non-null, non-array plain object — the shared shallow-copy /
 * validation-record guard.
 *
 * @param value - The value to check.
 * @returns Whether `value` is a non-null, non-array object.
 * @example
 * ```ts
 * isPlainObject({ x: 1 }); // true
 * isPlainObject([1, 2]);   // false
 * isPlainObject(null);     // false
 * ```
 */
export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Shallow-copies a captured component value into fresh plain data, so a `SceneDocument` never
 * aliases live SoA storage. Arrays and plain objects are copied one level deep; any other value
 * (a primitive) is returned as-is.
 *
 * @param value - The live component value to copy out.
 * @returns A shallow, storage-safe copy of `value`.
 * @example
 * ```ts
 * const live = { x: 1, y: 2 };
 * const copy = shallowCopyValue(live);
 * copy.x = 99;
 * live.x; // still 1 — the copy does not alias the live value
 * ```
 */
export const shallowCopyValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return [...value];
  if (isPlainObject(value)) return { ...value };
  return value;
};

/**
 * Coerces an arbitrary captured value into a plain record for `reflection.validate`, degrading a
 * non-object value to `{}` (mirrors `commands`' own `toMutable` fallback for the same seam — the
 * write-authority has already performed its own structural checks, so an empty record is a safe,
 * permissive default here).
 *
 * @param value - The raw component value to coerce.
 * @returns A plain `Record<string, unknown>`.
 * @example
 * ```ts
 * toRecord({ hp: 100 }); // → { hp: 100 }
 * toRecord(42);          // → {}
 * ```
 */
export const toRecord = (value: unknown): Record<string, unknown> =>
  isPlainObject(value) ? value : {};

/**
 * Walks the live world and captures every editor-owned entity's NAMED components into a
 * plain-data `SceneEntity[]`, in `world.liveEntities()` order. An entity with no `EditorId` (not
 * editor-owned — e.g. a system-spawned particle) is skipped; `world.componentsOf` already omits
 * anonymous (unnamed) components, so no filtering is needed here for those.
 *
 * @param world - The ECS world to read from.
 * @param commands - The `commands` slice used to resolve each entity's `EditorId`.
 * @returns The captured entities, each a plain-data shallow copy of its live components.
 * @example
 * ```ts
 * const entities = captureEntities(world, commands);
 * // → [{ id: 1, components: { Position: { x: 0, y: 0 } } }, ...]
 * ```
 */
export const captureEntities = (world: CaptureWorld, commands: CaptureCommands): SceneEntity[] => {
  const entities: SceneEntity[] = [];

  for (const entity of world.liveEntities()) {
    const id = commands.editorIdOf(entity);
    if (id === undefined) continue;

    const components: Record<string, unknown> = {};
    for (const { name, value } of world.componentsOf(entity)) {
      components[name] = shallowCopyValue(value);
    }
    entities.push({ id, components });
  }

  return entities;
};

/**
 * Structural shape guard for a parsed `import()` payload: `version` must be a number, `name` a
 * string, and `entities` an array. Does not deep-validate entity/component shape — that is
 * `reflection.validate`'s job once `deserialize` runs.
 *
 * @param value - The parsed (untyped) JSON payload.
 * @returns Whether `value` has the minimal `SceneDocument` shape.
 * @example
 * ```ts
 * isSceneDocumentShape({ version: 1, name: "level1", entities: [] }); // true
 * isSceneDocumentShape({ version: 1, name: "level1" });               // false — no entities
 * ```
 */
export const isSceneDocumentShape = (value: unknown): value is SceneDocument =>
  isPlainObject(value) &&
  typeof value.version === "number" &&
  typeof value.name === "string" &&
  Array.isArray(value.entities);

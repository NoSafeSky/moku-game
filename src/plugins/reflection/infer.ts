/**
 * @file reflection plugin — inference + label helpers.
 *
 * Pure functions over a plain live component value; ecs-free so unit tests need no world. This
 * is the "default, untyped, runtime-tagged" inference path (spec §Design decision — two type
 * paths) — conservative by design: it skips any key it cannot classify rather than guessing.
 */
import type { FieldDescriptor } from "./types";

/**
 * Produces a descriptor per own-enumerable key of a live component value by `typeof` dispatch.
 *
 * A non-object (or `null`) `value` yields `[]`. Keys that cannot be classified (arrays,
 * functions, nested non-`{x,y}` objects) are skipped rather than guessed, so an inferred
 * descriptor set is always safe to render.
 *
 * @param value - A representative live component value.
 * @param humanize - Whether the produced labels are humanized Title Case.
 * @returns One `FieldDescriptor` per classifiable own-enumerable key.
 * @example
 * ```ts
 * inferDescriptors({ hp: 100, alive: true }, true);
 * // => [{ kind: "number", key: "hp", label: "Hp" }, { kind: "boolean", key: "alive", label: "Alive" }]
 * ```
 */
export const inferDescriptors = (value: unknown, humanize: boolean): FieldDescriptor[] => {
  if (typeof value !== "object" || value === null) return [];

  const descriptors: FieldDescriptor[] = [];
  for (const [key, entryValue] of Object.entries(value)) {
    const descriptor = inferField(key, entryValue, humanize);
    if (descriptor !== undefined) descriptors.push(descriptor);
  }
  return descriptors;
};

/**
 * Maps one key/value pair to a field descriptor: `number`→number, `boolean`→boolean,
 * `string`→string, `{x:number,y:number}`→vector2; anything else (array, function, nested
 * non-vector object) is skipped.
 *
 * @param key - The own-enumerable key on the live value.
 * @param value - The value at that key.
 * @param humanize - Whether the produced label is humanized Title Case.
 * @returns The classified `FieldDescriptor`, or `undefined` when the value cannot be classified.
 * @example
 * ```ts
 * inferField("hp", 100, true); // { kind: "number", key: "hp", label: "Hp" }
 * ```
 */
const inferField = (
  key: string,
  value: unknown,
  humanize: boolean
): FieldDescriptor | undefined => {
  const label = labelFor(key, humanize);
  if (typeof value === "number") return { kind: "number", key, label };
  if (typeof value === "boolean") return { kind: "boolean", key, label };
  if (typeof value === "string") return { kind: "string", key, label };
  if (isVector2Shape(value)) return { kind: "vector2", key, label };
  return undefined;
};

/**
 * Determines whether a value is a plain `{x,y}` pair with both members numeric, and no other
 * own-enumerable keys — a `{x,y,z}` or `{x}` is not classified as a vector2.
 *
 * @param value - The candidate value.
 * @returns `true` when `value` is a two-key `{x: number, y: number}` object.
 * @example
 * ```ts
 * isVector2Shape({ x: 1, y: 2 }); // true
 * isVector2Shape({ x: 1, y: 2, z: 3 }); // false — 3 keys
 * ```
 */
const isVector2Shape = (value: unknown): value is { x: number; y: number } => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const entries = Object.entries(value);
  if (entries.length !== 2) return false;

  const record = Object.fromEntries(entries);
  return typeof record.x === "number" && typeof record.y === "number";
};

/**
 * Humanizes a field key to Title Case when `humanize` is `true`, splitting camelCase and
 * snake/kebab-case boundaries; otherwise returns the raw key unchanged.
 *
 * @param key - The raw field key.
 * @param humanize - Whether to humanize the key.
 * @returns The humanized label, or the raw `key` when `humanize` is `false`.
 * @example
 * ```ts
 * labelFor("scaleX", true); // "Scale X"
 * labelFor("hit_points", true); // "Hit Points"
 * labelFor("scaleX", false); // "scaleX"
 * ```
 */
export const labelFor = (key: string, humanize: boolean): string => {
  if (!humanize) return key;

  const words = key
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .filter(word => word.length > 0);

  return words.map(word => capitalize(word)).join(" ");
};

/**
 * Uppercases the first character of a word, leaving the remainder unchanged.
 *
 * @param word - The word to capitalize.
 * @returns `word` with its first character uppercased.
 * @example
 * ```ts
 * capitalize("scale"); // "Scale"
 * ```
 */
const capitalize = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

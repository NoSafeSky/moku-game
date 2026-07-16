/**
 * @file reflection plugin — pure field validation.
 *
 * Validates a partial component value against its field descriptors. Pure over
 * `(descriptors, partial)` — no world, no mutation; the only impurity in the seam is the
 * `describe` read that produced the descriptors (see `api.ts`).
 */
import type { FieldDescriptor, FieldError, ValidationResult } from "./types";

/**
 * Validates a partial component value against its field descriptors
 * (type / range / options / readonly / shape / unknown-field).
 *
 * An empty descriptor set (unknown/anonymous component, or a named component with no live
 * instance and no registered schema) is permissive — it returns `{ ok: true }`, since the
 * write-authority (`commands`) has already performed its own structural checks.
 *
 * @param descriptors - The field descriptors to validate against.
 * @param partial - The partial component value to check.
 * @returns `{ ok: true }` when every field in `partial` passes, else `{ ok: false, errors }`
 *   with one `{ key, message }` entry per offending field.
 * @example
 * ```ts
 * validateAgainst([{ kind: "number", key: "hp", label: "Hp", min: 0, max: 100 }], { hp: 150 });
 * // => { ok: false, errors: [{ key: "hp", message: "above maximum 100" }] }
 * ```
 */
export const validateAgainst = (
  descriptors: readonly FieldDescriptor[],
  partial: Readonly<Record<string, unknown>>
): ValidationResult => {
  if (descriptors.length === 0) return { ok: true };

  const byKey = new Map<string, FieldDescriptor>();
  for (const descriptor of descriptors) byKey.set(descriptor.key, descriptor);

  const errors: FieldError[] = [];
  for (const [key, value] of Object.entries(partial)) {
    const error = validateEntry(byKey, key, value);
    if (error !== undefined) errors.push(error);
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
};

/**
 * Validates a single `[key, value]` entry of a partial value against the descriptor map.
 *
 * @param byKey - The field descriptors, keyed by `key`.
 * @param key - The field key being written.
 * @param value - The value being written to `key`.
 * @returns A `FieldError` when the entry is rejected, else `undefined`.
 * @example
 * ```ts
 * validateEntry(byKey, "hp", 150); // { key: "hp", message: "above maximum 100" } (if out of range)
 * ```
 */
const validateEntry = (
  byKey: ReadonlyMap<string, FieldDescriptor>,
  key: string,
  value: unknown
): FieldError | undefined => {
  const descriptor = byKey.get(key);
  if (descriptor === undefined) return { key, message: "unknown field" };
  if (descriptor.readonly) return { key, message: "field is read-only" };

  const message = describeKindError(descriptor, value);
  return message === undefined ? undefined : { key, message };
};

/**
 * Checks a value against a descriptor's `kind`-specific rules (type / range / options / shape).
 *
 * @param descriptor - The field descriptor (already confirmed not read-only).
 * @param value - The candidate value.
 * @returns A human-readable rejection reason, or `undefined` when the value is accepted.
 * @example
 * ```ts
 * describeKindError({ kind: "number", key: "hp", label: "Hp", min: 0 }, "oops"); // "expected a number"
 * ```
 */
const describeKindError = (descriptor: FieldDescriptor, value: unknown): string | undefined => {
  switch (descriptor.kind) {
    case "number": {
      return describeNumberError(descriptor, value);
    }
    case "boolean": {
      return typeof value === "boolean" ? undefined : "expected a boolean";
    }
    case "string": {
      return typeof value === "string" ? undefined : "expected a string";
    }
    case "color": {
      return typeof value === "string" ? undefined : "expected a color string";
    }
    case "select": {
      return typeof value === "string" && descriptor.options.includes(value)
        ? undefined
        : "value not in options";
    }
    case "vector2": {
      return isVector2Like(value) ? undefined : "expected a { x, y } vector";
    }
    case "entity-ref": {
      return describeReferenceError(value, "number", "expected an entity id");
    }
    case "asset-ref": {
      return describeReferenceError(value, "string", "expected an asset alias string");
    }
  }
};

/**
 * Checks a reference-kind (`entity-ref`/`asset-ref`) value: accepted when `undefined` (unset) or
 * when `typeof value` matches `expectedType`, else rejected with `message`.
 *
 * @param value - The candidate value.
 * @param expectedType - The `typeof` tag the reference kind's non-`undefined` value must match.
 * @param message - The rejection reason to return when `value` fails the check.
 * @returns `undefined` when accepted, else `message`.
 * @example
 * ```ts
 * describeReferenceError(42, "number", "expected an entity id"); // undefined (accepted)
 * describeReferenceError("x", "number", "expected an entity id"); // "expected an entity id"
 * ```
 */
const describeReferenceError = (
  value: unknown,
  expectedType: "number" | "string",
  message: string
): string | undefined =>
  value === undefined || typeof value === expectedType ? undefined : message;

/**
 * Checks a value against a number descriptor's type and `min`/`max` bounds.
 *
 * @param descriptor - The number field descriptor.
 * @param value - The candidate value.
 * @returns A rejection reason, or `undefined` when the value is accepted.
 * @example
 * ```ts
 * describeNumberError({ kind: "number", key: "hp", label: "Hp", max: 100 }, 150); // "above maximum 100"
 * ```
 */
const describeNumberError = (
  descriptor: Extract<FieldDescriptor, { kind: "number" }>,
  value: unknown
): string | undefined => {
  if (typeof value !== "number") return "expected a number";
  if (descriptor.min !== undefined && value < descriptor.min)
    return `below minimum ${descriptor.min}`;
  if (descriptor.max !== undefined && value > descriptor.max)
    return `above maximum ${descriptor.max}`;
  return undefined;
};

/**
 * Determines whether a value is an object with numeric `x` and `y` members. Extra
 * own-enumerable keys are tolerated — unlike inference, validation does not need to distinguish
 * a vector2 from a richer shape.
 *
 * @param value - The candidate value.
 * @returns `true` when `value` has numeric `x` and `y` members.
 * @example
 * ```ts
 * isVector2Like({ x: 1, y: 2 }); // true
 * isVector2Like({ x: 1 }); // false
 * ```
 */
const isVector2Like = (value: unknown): value is { x: number; y: number } => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = Object.fromEntries(Object.entries(value));
  return typeof record.x === "number" && typeof record.y === "number";
};

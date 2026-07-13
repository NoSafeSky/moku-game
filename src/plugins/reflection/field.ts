/**
 * @file reflection plugin — `field.*` builder set.
 *
 * Pure, stateless builders for authoring a typed `Schema`. Safe to call at module scope, before
 * the app starts. Each returns a concrete discriminated-union member tagged by `kind` — no
 * generics, no single mapped type (spec/09 §1).
 */
import type { FieldBuilders, FieldSpec } from "./types";

/**
 * The `field.*` builder set for authoring a typed `Schema`.
 *
 * Every builder returns a concrete discriminated-union member (`NumberFieldSpec`,
 * `BooleanFieldSpec`, …) tagged by `kind` — an inspector switches on `descriptor.kind` with no
 * casts. Stateless: safe to call at module scope to build a `Schema` before the app starts.
 *
 * @example
 * ```ts
 * import { field } from "./field";
 * const schema = { hp: field.number({ min: 0, max: 100 }), state: field.select(["idle", "dead"]) };
 * ```
 */
export const field: FieldBuilders = {
  /**
   * Builds a number field spec; optional `min`/`max` bound `validate`, `step` is an inspector hint.
   *
   * @param opts - Optional bounds/step hint.
   * @param opts.min - Minimum accepted value (inclusive); `validate` rejects lower values.
   * @param opts.max - Maximum accepted value (inclusive); `validate` rejects higher values.
   * @param opts.step - Inspector step hint; not enforced by `validate`.
   * @returns A `NumberFieldSpec` carrying only the provided bounds (no undefined-valued keys).
   * @example
   * ```ts
   * field.number({ min: 0, max: 1, step: 0.05 }); // a normalized ratio control
   * ```
   */
  number: opts => ({ kind: "number", ...opts }),

  /**
   * Builds a boolean (checkbox) field spec.
   *
   * @returns A `BooleanFieldSpec`.
   * @example
   * ```ts
   * field.boolean(); // e.g. a `visible` flag
   * ```
   */
  boolean: () => ({ kind: "boolean" }),

  /**
   * Builds a free-text string field spec.
   *
   * @returns A `StringFieldSpec`.
   * @example
   * ```ts
   * field.string(); // e.g. a `label` field
   * ```
   */
  string: () => ({ kind: "string" }),

  /**
   * Builds a color field spec (value is a `#rrggbb`/`#rrggbbaa` string).
   *
   * @returns A `ColorFieldSpec`.
   * @example
   * ```ts
   * field.color(); // a `tint` that `typeof` alone would mis-read as string/number
   * ```
   */
  color: () => ({ kind: "color" }),

  /**
   * Builds an enum dropdown field spec; `validate` rejects any value not in `options`.
   *
   * @param options - The allowed values, in display order.
   * @returns A `SelectFieldSpec`.
   * @example
   * ```ts
   * field.select(["idle", "run", "jump"]); // an animation state enum
   * ```
   */
  select: options => ({ kind: "select", options }),

  /**
   * Builds a 2-component vector field spec (value is `{ x: number; y: number }`).
   *
   * @returns A `Vector2FieldSpec`.
   * @example
   * ```ts
   * field.vector2(); // e.g. a `velocity` { x, y }
   * ```
   */
  vector2: () => ({ kind: "vector2" }),

  /**
   * Wraps any field spec to mark it non-editable; `validate` rejects a write to a readonly
   * field. Preserves the inner spec's discriminant (`kind`) and its other fields.
   *
   * @param inner - The field spec to wrap as read-only.
   * @returns A copy of `inner` with `readonly: true`.
   * @example
   * ```ts
   * field.readonly(field.number()); // a computed value the inspector shows but can't edit
   * ```
   */
  readonly: (inner: FieldSpec) => ({ ...inner, readonly: true })
};

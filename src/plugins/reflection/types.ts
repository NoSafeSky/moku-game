/**
 * @file reflection plugin — public type surface (Config, State, FieldSpec/FieldDescriptor unions, Api).
 */

/**
 * reflection plugin configuration — defaults applied when a consumer omits a field.
 */
export type Config = {
  /**
   * When true, an inferred/registered descriptor's `label` is a humanized Title Case form of its
   * `key` (e.g. `scaleX` → "Scale X", `hit_points` → "Hit Points"); when false, `label` is the raw
   * `key`. Only affects the display `label`, never the `key` used for reads/writes.
   *
   * @default true
   */
  humanizeLabels: boolean;
};

/** A number control intent; optional `min`/`max` bound `validate`, `step` is an inspector hint. */
export type NumberFieldSpec = {
  kind: "number";
  min?: number;
  max?: number;
  step?: number;
  readonly?: boolean;
};

/** A boolean (checkbox) control intent. */
export type BooleanFieldSpec = { kind: "boolean"; readonly?: boolean };

/** A free-text string control intent. */
export type StringFieldSpec = { kind: "string"; readonly?: boolean };

/** A color control intent (value is a `#rrggbb`/`#rrggbbaa` string). */
export type ColorFieldSpec = { kind: "color"; readonly?: boolean };

/** An enum dropdown control intent; `validate` rejects any value not in `options`. */
export type SelectFieldSpec = { kind: "select"; options: readonly string[]; readonly?: boolean };

/** A 2-component vector control intent (value is `{ x: number; y: number }`). */
export type Vector2FieldSpec = { kind: "vector2"; readonly?: boolean };

/** The union a `field.*` builder produces; the value type of a registered `Schema`. */
export type FieldSpec =
  | NumberFieldSpec
  | BooleanFieldSpec
  | StringFieldSpec
  | ColorFieldSpec
  | SelectFieldSpec
  | Vector2FieldSpec;

/** A registered schema: field key → its display/validation intent (Leva/Tweakpane control-object shape). */
export type Schema = Record<string, FieldSpec>;

/** A materialized number descriptor = its `FieldSpec` plus identity (`key`, `label`). */
export type NumberField = NumberFieldSpec & { key: string; label: string };

/** A materialized boolean descriptor = its `FieldSpec` plus identity (`key`, `label`). */
export type BooleanField = BooleanFieldSpec & { key: string; label: string };

/** A materialized string descriptor = its `FieldSpec` plus identity (`key`, `label`). */
export type StringField = StringFieldSpec & { key: string; label: string };

/** A materialized color descriptor = its `FieldSpec` plus identity (`key`, `label`). */
export type ColorField = ColorFieldSpec & { key: string; label: string };

/** A materialized select descriptor = its `FieldSpec` plus identity (`key`, `label`). */
export type SelectField = SelectFieldSpec & { key: string; label: string };

/** A materialized vector2 descriptor = its `FieldSpec` plus identity (`key`, `label`). */
export type Vector2Field = Vector2FieldSpec & { key: string; label: string };

/** The public field-descriptor union `describe` returns — narrow on `.kind`. */
export type FieldDescriptor =
  | NumberField
  | BooleanField
  | StringField
  | ColorField
  | SelectField
  | Vector2Field;

/** A single validation failure — the field `key` and a human-readable reason. */
export type FieldError = { key: string; message: string };

/** Result of `validate` — either accepted, or rejected with one error per offending field. */
export type ValidationResult = { ok: true } | { ok: false; errors: readonly FieldError[] };

/** The `field.*` builder set — pure, stateless helpers for authoring a typed `Schema`. */
export type FieldBuilders = {
  /** A number control; optional `min`/`max` bound `validate`, `step` is an inspector hint. */
  number(opts?: { min?: number; max?: number; step?: number }): NumberFieldSpec;
  /** A boolean (checkbox) control. */
  boolean(): BooleanFieldSpec;
  /** A free-text string control. */
  string(): StringFieldSpec;
  /** A color control (value is a `#rrggbb`/`#rrggbbaa` string). */
  color(): ColorFieldSpec;
  /** An enum dropdown; `validate` rejects any value not in `options`. */
  select(options: readonly string[]): SelectFieldSpec;
  /** A 2-component vector control (value is `{ x: number; y: number }`). */
  vector2(): Vector2FieldSpec;
  /** Wrap any spec to mark it non-editable — `validate` rejects a write to a readonly field. */
  readonly(inner: FieldSpec): FieldSpec;
};

/**
 * reflection plugin state — the registered schemas and a memoized inference cache.
 */
export type State = {
  /**
   * Registered typed schemas, materialized to `FieldDescriptor[]` keyed by component name.
   * Populated by `register`; a present entry ALWAYS wins over inference for that name.
   */
  readonly schemas: Map<string, FieldDescriptor[]>;
  /**
   * Memoized inference results keyed by component name (a component's SoA shape is fixed by its
   * `create()`, so the descriptor set is stable once a live instance has been seen). Filled lazily
   * by `describe`; a `register(name, …)` call deletes the matching entry so the schema takes over.
   */
  readonly inferred: Map<string, FieldDescriptor[]>;
};

/** Public API surface (`app.reflection`). */
export type Api = {
  /**
   * The `FieldDescriptor[]` for a named component: a registered schema if one exists, else inferred
   * from a live value, else `[]` (unknown/anonymous component, or no live instance + no schema).
   */
  describe(componentName: string): FieldDescriptor[];
  /** Register a typed schema for a component name; it shadows inference for that name thereafter. */
  register(componentName: string, schema: Schema): void;
  /** Validate a partial component value against its descriptors (type/range/options/readonly/shape). */
  validate(componentName: string, partial: Readonly<Record<string, unknown>>): ValidationResult;
  /** The `field.*` builder set, also exported standalone from the plugin for module-scope authoring. */
  readonly field: FieldBuilders;
};

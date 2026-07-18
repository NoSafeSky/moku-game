/** @file Map a reflection FieldDescriptor to an editable DOM control, and read its value back. */
import type { Reflection } from "@nosafesky/ludemic";

// ─── Value coercion (snapshots hand us `unknown`; stay defensive) ───

// A finite number as an input's `value` string, or "" for anything non-numeric.
const numericString = (value: unknown): string =>
  typeof value === "number" && Number.isFinite(value) ? String(value) : "";

// Coerce an unknown snapshot value to an { x, y } pair, defaulting a missing/non-object to the origin.
const asVector2 = (value: unknown): { x: number; y: number } => {
  if (typeof value === "object" && value && "x" in value && "y" in value) {
    return { x: Number(value.x), y: Number(value.y) };
  }
  return { x: 0, y: 0 };
};

// ─── Per-kind control builders (each disables itself when the field is readonly) ───

// A number input carrying the descriptor's min/max/step hints.
const numberInput = (descriptor: Reflection.NumberField, value: unknown): HTMLInputElement => {
  const input = document.createElement("input");
  input.type = "number";
  if (descriptor.min !== undefined) input.min = String(descriptor.min);
  if (descriptor.max !== undefined) input.max = String(descriptor.max);
  if (descriptor.step !== undefined) input.step = String(descriptor.step);
  input.value = numericString(value);
  input.disabled = descriptor.readonly === true;
  return input;
};

// A checkbox reflecting a boolean value.
const checkbox = (descriptor: Reflection.BooleanField, value: unknown): HTMLInputElement => {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = value === true;
  input.disabled = descriptor.readonly === true;
  return input;
};

// A free-text input.
const textInput = (descriptor: Reflection.StringField, value: unknown): HTMLInputElement => {
  const input = document.createElement("input");
  input.type = "text";
  input.value = String(value ?? "");
  input.disabled = descriptor.readonly === true;
  return input;
};

// A native color picker (value is a `#rrggbb` string).
const colorInput = (descriptor: Reflection.ColorField, value: unknown): HTMLInputElement => {
  const input = document.createElement("input");
  input.type = "color";
  input.value = typeof value === "string" ? value : "#000000";
  input.disabled = descriptor.readonly === true;
  return input;
};

// An enum dropdown with one option per choice.
const selectInput = (descriptor: Reflection.SelectField, value: unknown): HTMLSelectElement => {
  const select = document.createElement("select");
  for (const choice of descriptor.options) {
    const option = document.createElement("option");
    option.value = choice;
    option.textContent = choice;
    select.append(option);
  }
  if (typeof value === "string") select.value = value;
  select.disabled = descriptor.readonly === true;
  return select;
};

// One labelled axis input (`data-axis="x"|"y"`) for the vector2 control.
const axisInput = (name: "x" | "y", value: number, disabled: boolean): HTMLInputElement => {
  const input = document.createElement("input");
  input.type = "number";
  input.dataset.axis = name;
  input.value = numericString(value);
  input.disabled = disabled;
  return input;
};

// A vector2 control: a container holding an x and a y number input.
const vector2Control = (descriptor: Reflection.Vector2Field, value: unknown): HTMLElement => {
  const container = document.createElement("div");
  const vector = asVector2(value);
  const disabled = descriptor.readonly === true;
  container.append(axisInput("x", vector.x, disabled), axisInput("y", vector.y, disabled));
  return container;
};

// A reference control (entity-ref/asset-ref) — a read-only name chip showing the current target. The
// interactive "⋯" target picker (D9) lands in A4; until then the reference is displayed, not edited.
const referenceInput = (
  descriptor: Reflection.EntityRefField | Reflection.AssetRefField,
  value: unknown
): HTMLInputElement => {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value === undefined || value === null ? "" : String(value);
  input.readOnly = true;
  input.disabled = descriptor.readonly === true;
  return input;
};

// Dispatch to the control builder for the descriptor's kind.
const buildControl = (descriptor: Reflection.FieldDescriptor, value: unknown): HTMLElement => {
  switch (descriptor.kind) {
    case "number": {
      return numberInput(descriptor, value);
    }
    case "boolean": {
      return checkbox(descriptor, value);
    }
    case "string": {
      return textInput(descriptor, value);
    }
    case "color": {
      return colorInput(descriptor, value);
    }
    case "select": {
      return selectInput(descriptor, value);
    }
    case "vector2": {
      return vector2Control(descriptor, value);
    }
    case "entity-ref":
    case "asset-ref": {
      return referenceInput(descriptor, value);
    }
  }
};

// ─── Read-back narrowing (the control's concrete type is guaranteed by renderControl) ───

// Narrow a control element to an `<input>`, or throw (the reader was handed the wrong element).
const asInput = (el: HTMLElement): HTMLInputElement => {
  if (el instanceof HTMLInputElement) return el;
  throw new Error("[field-controls] Expected an <input> control element.");
};

// Narrow a control element to a `<select>`, or throw.
const asSelect = (el: HTMLElement): HTMLSelectElement => {
  if (el instanceof HTMLSelectElement) return el;
  throw new Error("[field-controls] Expected a <select> control element.");
};

// Read one axis value from a vector2 control (NaN when the axis input is missing).
const axisValue = (el: HTMLElement, name: "x" | "y"): number => {
  const input = el.querySelector<HTMLInputElement>(`[data-axis="${name}"]`);
  return input ? input.valueAsNumber : Number.NaN;
};

/**
 * Build an editable control element for one field descriptor, seeded with `value`.
 *
 * The returned element carries `data-field-key` + `data-field-kind` (and `data-readonly` when the
 * field is non-editable) — identity as data-* only, never classes — so the inspector island can
 * route the read/write back through {@link readControl}.
 *
 * @param descriptor - The reflection field descriptor (discriminated on `kind`).
 * @param value - The current field value from the snapshot.
 * @returns The control element (an `<input>`/`<select>`, or a container of two inputs for `vector2`).
 * @example
 * ```ts
 * const el = renderControl({ kind: "number", key: "x", label: "X", min: 0 }, 128);
 * ```
 */
export function renderControl(descriptor: Reflection.FieldDescriptor, value: unknown): HTMLElement {
  const control = buildControl(descriptor, value);

  // Stamp field identity + kind as data-* so the island can route reads/writes and CSS can style per kind.
  control.dataset.fieldKey = descriptor.key;
  control.dataset.fieldKind = descriptor.kind;
  if (descriptor.readonly === true) control.dataset.readonly = "";

  return control;
}

/**
 * Read the current value out of a control element for a descriptor.
 *
 * Returns the RAW control value (numbers are NOT clamped to min/max) — range/option/readonly
 * validation is the bridge's job via `reflection.validate`, not the control's.
 *
 * The concrete union return type (never `unknown`) keeps the `switch` exhaustive at compile time:
 * add another `FieldDescriptor` kind without a case here and TS2366 fails the build — matching the
 * guarantee `renderControl` already gets from its `HTMLElement` return.
 *
 * @param el - The control element built by {@link renderControl}.
 * @param descriptor - The same descriptor used to build it (selects the read strategy).
 * @returns The parsed value to hand to `bridge.setField` (`number` | `boolean` | `string` | `{ x, y }`).
 * @example
 * ```ts
 * const value = readControl(el, { kind: "number", key: "x", label: "X" });
 * ```
 */
export function readControl(
  el: HTMLElement,
  descriptor: Reflection.FieldDescriptor
): number | boolean | string | { x: number; y: number } {
  switch (descriptor.kind) {
    case "boolean": {
      return asInput(el).checked;
    }
    case "number": {
      return asInput(el).valueAsNumber;
    }
    case "string":
    case "color": {
      return asInput(el).value;
    }
    case "select": {
      return asSelect(el).value;
    }
    case "vector2": {
      return { x: axisValue(el, "x"), y: axisValue(el, "y") };
    }
    case "entity-ref":
    case "asset-ref": {
      return asInput(el).value;
    }
  }
}

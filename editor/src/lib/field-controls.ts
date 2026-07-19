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

// ─── Numeric drag-scrub (F3) — press + drag a mono numeric field to scrub its value ───

// A press must travel this far (px) before it becomes a scrub; below it, the press falls through to a
// plain focus/text-edit — so scrub and type share one control with no mode switch (design-context §4).
const SCRUB_THRESHOLD = 3;

/**
 * Make a numeric input drag-scrubbable: pressing and dragging horizontally live-updates its value by
 * `step` per pixel; a press that never travels {@link SCRUB_THRESHOLD}px leaves the value untouched and
 * lets normal focus/text-edit proceed. A committed scrub dispatches a bubbling `change` on release, so the
 * inspector's existing delegated `change` → `bridge.setField` path picks it up unchanged.
 *
 * @param input - The numeric input to make scrubbable.
 * @param step - Units added per horizontal pixel of drag.
 * @example
 * ```ts
 * attachScrub(numberEl, 0.1);
 * ```
 */
export function attachScrub(input: HTMLInputElement, step: number): void {
  input.addEventListener("pointerdown", (event: PointerEvent): void => {
    // A readonly/disabled field never scrubs; only the primary button scrubs.
    if (input.disabled || input.readOnly || event.button !== 0) return;

    const startX = event.clientX;
    const startValue = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : 0;
    let scrubbing = false;

    // Track horizontal travel; once past the threshold, the press is a scrub and the value follows it.
    const onMove = (move: PointerEvent): void => {
      const dx = move.clientX - startX;
      if (!scrubbing && Math.abs(dx) < SCRUB_THRESHOLD) return;
      if (!scrubbing) {
        scrubbing = true;
        input.dataset.scrubbing = "";
      }
      input.value = String(startValue + dx * step);
    };

    // Commit a real scrub (change → setField); a zero-move press committed nothing and just focused.
    const onUp = (): void => {
      globalThis.removeEventListener("pointermove", onMove);
      globalThis.removeEventListener("pointerup", onUp);
      if (!scrubbing) return;
      delete input.dataset.scrubbing;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };

    globalThis.addEventListener("pointermove", onMove);
    globalThis.addEventListener("pointerup", onUp);
  });
}

// ─── Per-kind control builders (each disables itself when the field is readonly) ───

// A number input carrying the descriptor's min/max/step hints, made drag-scrubbable.
const numberInput = (descriptor: Reflection.NumberField, value: unknown): HTMLInputElement => {
  const input = document.createElement("input");
  input.type = "number";
  if (descriptor.min !== undefined) input.min = String(descriptor.min);
  if (descriptor.max !== undefined) input.max = String(descriptor.max);
  if (descriptor.step !== undefined) input.step = String(descriptor.step);
  input.value = numericString(value);
  input.disabled = descriptor.readonly === true;
  attachScrub(input, descriptor.step ?? 1);
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

// One labelled axis input (`data-axis="x"|"y"`) for the vector2 control, drag-scrubbable.
const axisInput = (name: "x" | "y", value: number, disabled: boolean): HTMLInputElement => {
  const input = document.createElement("input");
  input.type = "number";
  input.dataset.axis = name;
  input.value = numericString(value);
  input.disabled = disabled;
  attachScrub(input, 1);
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

// The raw display string for a reference value: the entity id / asset alias, or "" (unset).
const referenceValueString = (value: unknown): string =>
  value === undefined || value === null ? "" : String(value);

// A reference control (entity-ref/asset-ref): an icon + a mono name chip + a "⋯" picker button. The
// current target value rides `data-ref-value` (`""` = unset); the inspector island opens the anchored
// candidate picker (D9) from the "⋯" button and resolves the chip's display name from the snapshot.
const referenceControl = (
  descriptor: Reflection.EntityRefField | Reflection.AssetRefField,
  value: unknown
): HTMLElement => {
  const container = document.createElement("div");
  const raw = referenceValueString(value);
  container.dataset.refValue = raw;

  const icon = document.createElement("span");
  icon.dataset.refIcon = "";
  icon.textContent = descriptor.kind === "entity-ref" ? "▶" : "⧉";
  container.append(icon);

  const name = document.createElement("span");
  name.dataset.refName = "";
  name.dataset.mono = "";
  name.textContent = raw === "" ? "None" : raw;
  container.append(name);

  const pick = document.createElement("button");
  pick.type = "button";
  pick.dataset.refPick = "";
  pick.textContent = "⋯";
  pick.disabled = descriptor.readonly === true;
  container.append(pick);

  return container;
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
      return referenceControl(descriptor, value);
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

// Read a reference control's current target: `undefined` when unset, an `EditorId` (number) for an
// entity-ref, the asset alias (string) for an asset-ref.
const referenceValue = (el: HTMLElement, entity: boolean): number | string | undefined => {
  const raw = el.dataset.refValue ?? "";
  if (raw === "") return undefined;
  return entity ? Number(raw) : raw;
};

/**
 * One candidate row of a reference picker (D9): the raw value to set + a human label.
 */
export type ReferenceCandidate = {
  /** The raw value written to the control's `data-ref-value` (entity id string, or asset alias). */
  readonly value: string;
  /** The label shown in the picker list. */
  readonly label: string;
};

/**
 * Merge the manifest asset aliases with the imported-store aliases into one deduped asset-ref
 * candidate list (P2). Manifest entries come first, then imports; a later duplicate of an alias
 * already seen is dropped, so an imported asset that shadows a manifest alias appears once. Each
 * candidate's `value` and `label` are the alias itself — the alias is exactly what rides in
 * `SpriteRenderer.sprite`, so the picker writes back a value the resolver can resolve.
 *
 * @param manifestAliases - Aliases from `assets.entries()` (framework manifest), in display order.
 * @param storeAliases - Aliases from `assetStore.entries()` (imported), in display order.
 * @returns The deduped candidate rows, manifest-first.
 * @example
 * ```ts
 * mergeAssetCandidates(["hero"], ["coin-a1", "hero"]); // hero, coin-a1
 * ```
 */
export function mergeAssetCandidates(
  manifestAliases: readonly string[],
  storeAliases: readonly string[]
): readonly ReferenceCandidate[] {
  const seen = new Set<string>();
  const candidates: ReferenceCandidate[] = [];

  for (const alias of [...manifestAliases, ...storeAliases]) {
    if (seen.has(alias)) continue;
    seen.add(alias);
    candidates.push({ value: alias, label: alias });
  }
  return candidates;
}

/**
 * Options for {@link openReferencePicker}.
 */
export type ReferencePickerOptions = {
  /** The "⋯" button (or chip) the picker anchors under. */
  readonly anchor: HTMLElement;
  /** The selectable targets, in display order. */
  readonly candidates: readonly ReferenceCandidate[];
  /** Called with the chosen raw value, or `undefined` for the "None" (clear) row. */
  readonly onPick: (value: string | undefined) => void;
  /** Where to mount the (position:fixed) picker — defaults to `document.body`. Pass an in-scope host so scoped CSS applies. */
  readonly container?: HTMLElement;
};

/**
 * Open the anchored reference-target picker (D9): a "None" row to clear, then one row per candidate.
 * Clicking a row calls `onPick` and closes; an outside click or Escape closes without a pick. Self-managing
 * — the returned function force-closes it (call it on island destroy).
 *
 * @param opts - The anchor, candidate rows, and pick callback.
 * @returns A function that closes the picker (idempotent).
 * @example
 * ```ts
 * const close = openReferencePicker({ anchor: pickBtn, candidates, onPick: v => setRef(v) });
 * ```
 */
export function openReferencePicker(opts: ReferencePickerOptions): () => void {
  const picker = document.createElement("div");
  picker.dataset.refPicker = "";

  const rect = opts.anchor.getBoundingClientRect();
  picker.style.left = `${rect.left}px`;
  picker.style.top = `${rect.bottom}px`;

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    picker.remove();
    document.removeEventListener("pointerdown", onOutside);
    document.removeEventListener("keydown", onKey);
  };

  const onOutside = (event: Event): void => {
    if (event.target instanceof Node && !picker.contains(event.target)) close();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") close();
  };

  const addRow = (label: string, value?: string): void => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.refOption = "";
    if (value !== undefined) button.dataset.value = value;
    button.textContent = label;
    button.addEventListener("click", () => {
      opts.onPick(value);
      close();
    });
    picker.append(button);
  };

  addRow("None");
  for (const candidate of opts.candidates) addRow(candidate.label, candidate.value);

  (opts.container ?? document.body).append(picker);
  // Defer the outside-click wiring so the originating click that opened the picker does not close it.
  document.addEventListener("pointerdown", onOutside);
  document.addEventListener("keydown", onKey);
  return close;
}

/**
 * Build an editable control element for one field descriptor, seeded with `value`.
 *
 * The returned element carries `data-field-key` + `data-field-kind` (and `data-readonly` when the
 * field is non-editable) — identity as data-* only, never classes — so the inspector island can
 * route the read/write back through {@link readControl}.
 *
 * @param descriptor - The reflection field descriptor (discriminated on `kind`).
 * @param value - The current field value from the snapshot.
 * @returns The control element (an `<input>`/`<select>`, a container of two inputs for `vector2`, or a
 *   reference chip for `entity-ref`/`asset-ref`).
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
 * validation is the bridge's job via `reflection.validate`, not the control's. A reference control
 * reads its `data-ref-value`: `undefined` when unset, else an `EditorId` (entity-ref) or asset alias
 * (asset-ref).
 *
 * The concrete union return type (never `unknown`) keeps the `switch` exhaustive at compile time:
 * add another `FieldDescriptor` kind without a case here and TS2366 fails the build — matching the
 * guarantee `renderControl` already gets from its `HTMLElement` return.
 *
 * @param el - The control element built by {@link renderControl}.
 * @param descriptor - The same descriptor used to build it (selects the read strategy).
 * @returns The parsed value to hand to `bridge.setField`.
 * @example
 * ```ts
 * const value = readControl(el, { kind: "number", key: "x", label: "X" });
 * ```
 */
export function readControl(
  el: HTMLElement,
  descriptor: Reflection.FieldDescriptor
): number | boolean | string | { x: number; y: number } | undefined {
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
    case "entity-ref": {
      return referenceValue(el, true);
    }
    case "asset-ref": {
      return referenceValue(el, false);
    }
  }
}

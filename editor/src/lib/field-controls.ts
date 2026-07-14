/** @file Map a reflection FieldDescriptor to an editable DOM control, and read its value back. */
import type { Reflection } from "@nosafesky/moku-game";

/**
 * Build an editable control element for one field descriptor, seeded with `value`.
 *
 * @param _descriptor - The reflection field descriptor (discriminated on `kind`).
 * @param _value - The current field value from the snapshot.
 * @throws {Error} Until W2 implements the per-kind control mapping.
 * @example
 * ```ts
 * const el = renderControl({ kind: "number", key: "x", label: "X", min: 0 }, 128);
 * ```
 */
export function renderControl(
  _descriptor: Reflection.FieldDescriptor,
  _value: unknown
): HTMLElement {
  throw new Error("[field-controls] not implemented");
}

/**
 * Read the current value out of a control element for a descriptor.
 *
 * @param _el - The control element built by renderControl.
 * @param _descriptor - The same descriptor used to build it.
 * @throws {Error} Until W2 implements value read-back.
 * @example
 * ```ts
 * const value = readControl(el, { kind: "number", key: "x", label: "X" });
 * ```
 */
export function readControl(_el: HTMLElement, _descriptor: Reflection.FieldDescriptor): unknown {
  throw new Error("[field-controls] not implemented");
}

/**
 * @file reflection plugin — pure field validation skeleton.
 */
import type { FieldDescriptor, ValidationResult } from "./types";

/**
 * Validates a partial component value against its field descriptors
 * (type / range / options / readonly / shape / unknown-field).
 *
 * @param _descriptors - The field descriptors to validate against.
 * @param _partial - The partial component value to check.
 * @throws {Error} Always in the skeleton — implemented during build.
 * @example
 * ```ts
 * validateAgainst(descriptors, { hp: 50 });
 * ```
 */
export function validateAgainst(
  _descriptors: readonly FieldDescriptor[],
  _partial: Readonly<Record<string, unknown>>
): ValidationResult {
  throw new Error("not implemented");
}

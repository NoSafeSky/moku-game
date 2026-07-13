/**
 * @file reflection plugin — inference + label helpers skeleton.
 */
import type { FieldDescriptor } from "./types";

/**
 * Produces a descriptor per own-enumerable key of a live component value by `typeof` dispatch.
 *
 * @param _value - A representative live component value.
 * @param _humanize - Whether the produced labels are humanized.
 * @throws {Error} Always in the skeleton — implemented during build.
 * @example
 * ```ts
 * inferDescriptors({ hp: 100 }, true);
 * ```
 */
export function inferDescriptors(_value: unknown, _humanize: boolean): FieldDescriptor[] {
  throw new Error("not implemented");
}

/**
 * Humanizes a field key to Title Case when `humanize`, else returns the raw key.
 *
 * @param _key - The raw field key.
 * @param _humanize - Whether to humanize the key.
 * @throws {Error} Always in the skeleton — implemented during build.
 * @example
 * ```ts
 * labelFor("scaleX", true); // "Scale X"
 * ```
 */
export function labelFor(_key: string, _humanize: boolean): string {
  throw new Error("not implemented");
}

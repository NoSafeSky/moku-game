/**
 * @file reflection plugin — `field.*` builder set skeleton.
 */
import type { FieldBuilders } from "./types";

/**
 * The `field.*` builder set for authoring a typed `Schema` (skeleton — implemented during build).
 */
export const field: FieldBuilders = {
  /**
   * Builds a number field spec (skeleton).
   *
   * @throws {Error} Always in the skeleton — implemented during build.
   * @example
   * ```ts
   * field.number({ min: 0, max: 1 });
   * ```
   */
  number: () => {
    throw new Error("not implemented");
  },
  /**
   * Builds a boolean field spec (skeleton).
   *
   * @throws {Error} Always in the skeleton — implemented during build.
   * @example
   * ```ts
   * field.boolean();
   * ```
   */
  boolean: () => {
    throw new Error("not implemented");
  },
  /**
   * Builds a string field spec (skeleton).
   *
   * @throws {Error} Always in the skeleton — implemented during build.
   * @example
   * ```ts
   * field.string();
   * ```
   */
  string: () => {
    throw new Error("not implemented");
  },
  /**
   * Builds a color field spec (skeleton).
   *
   * @throws {Error} Always in the skeleton — implemented during build.
   * @example
   * ```ts
   * field.color();
   * ```
   */
  color: () => {
    throw new Error("not implemented");
  },
  /**
   * Builds a select field spec (skeleton).
   *
   * @throws {Error} Always in the skeleton — implemented during build.
   * @example
   * ```ts
   * field.select(["a", "b"]);
   * ```
   */
  select: () => {
    throw new Error("not implemented");
  },
  /**
   * Builds a vector2 field spec (skeleton).
   *
   * @throws {Error} Always in the skeleton — implemented during build.
   * @example
   * ```ts
   * field.vector2();
   * ```
   */
  vector2: () => {
    throw new Error("not implemented");
  },
  /**
   * Wraps a field spec as read-only (skeleton).
   *
   * @throws {Error} Always in the skeleton — implemented during build.
   * @example
   * ```ts
   * field.readonly(field.number());
   * ```
   */
  readonly: () => {
    throw new Error("not implemented");
  }
};

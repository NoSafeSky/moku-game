/**
 * @file graphics-2d plugin — component default factories (skeleton).
 *
 * One source of truth for creation defaults: the world `defineComponent` create() and the
 * component-registry catalog `defaults` both read from these. Orphan until F3.
 */
import type { ShapeValue, SpriteRendererValue } from "./types";

/**
 * Default SpriteRenderer value — the world `defineComponent` create() + the component-registry `defaults`.
 *
 * @throws {Error} Always — this is a skeleton stub, implemented by the F3 build wave.
 * @example
 * ```ts
 * const value = createSpriteRenderer();
 * ```
 */
export const createSpriteRenderer = (): SpriteRendererValue => {
  throw new Error("not implemented");
};

/**
 * Default Shape value — the world `defineComponent` create() + the component-registry `defaults`.
 *
 * @throws {Error} Always — this is a skeleton stub, implemented by the F3 build wave.
 * @example
 * ```ts
 * const value = createShape();
 * ```
 */
export const createShape = (): ShapeValue => {
  throw new Error("not implemented");
};

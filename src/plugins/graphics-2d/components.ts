/**
 * @file graphics-2d plugin — component default factories + their catalog projection.
 *
 * One source of truth for creation defaults. Each factory is used two ways: as the world's
 * `defineComponent(create, …)` SoA default, and as the `component-registry` catalog entry's
 * `defaults` — so a component added through the inspector's Add-Component picker is seeded from
 * exactly the shape the world would have created.
 */
import type { ComponentCatalogEntry } from "../component-registry/types";
import type { ShapeValue, SpriteRendererValue } from "./types";

/**
 * Builds the default SpriteRenderer value — an untinted, unflipped sprite with no alias yet (an
 * empty alias resolves to the renderer's placeholder until one is picked in the inspector).
 *
 * Returns a FRESH object per call: the world's SoA default and the catalog's `defaults` must never
 * alias one another, or editing one entity's component would leak into the next spawn.
 *
 * @returns A new SpriteRenderer component value at its defaults.
 * @example
 * ```ts
 * const spriteToken = world.defineComponent(createSpriteRenderer, { name: "SpriteRenderer" });
 * ```
 */
export const createSpriteRenderer = (): SpriteRendererValue => ({
  sprite: "",
  tint: "#ffffff",
  flipX: false,
  sortingLayer: "Default",
  orderInLayer: 0
});

/**
 * Builds the default Shape value — a 100x100 light-gray rect with no stroke. `radius` is carried at
 * its own default even for a `rect` so flipping `kind` to `"circle"` in the inspector yields a
 * visible circle rather than a zero-radius dot.
 *
 * Returns a FRESH object per call, for the same reason as {@link createSpriteRenderer}.
 *
 * @returns A new Shape component value at its defaults.
 * @example
 * ```ts
 * const shapeToken = world.defineComponent(createShape, { name: "Shape" });
 * ```
 */
export const createShape = (): ShapeValue => ({
  kind: "rect",
  width: 100,
  height: 100,
  radius: 50,
  fill: "#cccccc",
  stroke: "#000000",
  strokeWidth: 0
});

/**
 * Builds the Add-Component catalog entries graphics-2d contributes, in picker order.
 *
 * `Transform` is listed as NON-addable: every object implicitly has one, so the picker shows it
 * under its own section but never offers to add it. Its `defaults` mirror the renderer's own
 * `Transform.create()` shape — graphics-2d owns the catalog projection, the renderer owns the
 * component. `SpriteRenderer`/`Shape` are addable, seeded from the factories above.
 *
 * Fresh entries (and fresh `defaults`) per call, so a consumer mutating one never corrupts the
 * catalog.
 *
 * @returns The three catalog entries, in registration order.
 * @example
 * ```ts
 * for (const entry of catalogEntries()) registry.register(entry);
 * ```
 */
export const catalogEntries = (): readonly ComponentCatalogEntry[] => [
  {
    name: "Transform",
    category: "Transform",
    defaults: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    addable: false
  },
  {
    name: "SpriteRenderer",
    category: "Rendering",
    defaults: createSpriteRenderer(),
    addable: true
  },
  {
    name: "Shape",
    category: "Rendering",
    defaults: createShape(),
    addable: true
  }
];

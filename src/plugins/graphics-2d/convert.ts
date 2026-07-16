/**
 * @file graphics-2d plugin — pure Pixi-free conversion helpers (skeleton).
 *
 * Component values in, renderer plain-data / signature strings out. No world, no context — the F3
 * wave unit-tests these directly. Orphan until F3 wires them into `sync.ts`.
 */
import type { PrimitiveSpec } from "../renderer/types";
import type { ShapeValue, SpriteRendererValue } from "./types";

/**
 * Parses a `#rrggbb` hex string to a hex int (e.g. "#ff0000" → 0xff0000); 0 on a malformed value.
 *
 * @param _hex - The `#rrggbb` color string.
 * @throws {Error} Always — this is a skeleton stub, implemented by the F3 build wave.
 * @example
 * ```ts
 * parseHexColor("#ff0000"); // 0xff0000
 * ```
 */
export function parseHexColor(_hex: string): number {
  throw new Error("not implemented");
}

/**
 * Maps a ShapeValue to the renderer's plain-data PrimitiveSpec (hex-string colors → hex ints).
 *
 * @param _shape - The Shape component value.
 * @throws {Error} Always — this is a skeleton stub, implemented by the F3 build wave.
 * @example
 * ```ts
 * renderer.attachPrimitive(entity, shapeToPrimitiveSpec(shape));
 * ```
 */
export function shapeToPrimitiveSpec(_shape: ShapeValue): PrimitiveSpec {
  throw new Error("not implemented");
}

/**
 * Cheap value signature for a Shape — a rebuild is triggered when it changes between ticks.
 *
 * @param _shape - The Shape component value.
 * @throws {Error} Always — this is a skeleton stub, implemented by the F3 build wave.
 * @example
 * ```ts
 * const sig = shapeSig(shape);
 * ```
 */
export function shapeSig(_shape: ShapeValue): string {
  throw new Error("not implemented");
}

/**
 * Cheap value signature for a SpriteRenderer.
 *
 * @param _sprite - The SpriteRenderer component value.
 * @throws {Error} Always — this is a skeleton stub, implemented by the F3 build wave.
 * @example
 * ```ts
 * const sig = spriteSig(sprite);
 * ```
 */
export function spriteSig(_sprite: SpriteRendererValue): string {
  throw new Error("not implemented");
}

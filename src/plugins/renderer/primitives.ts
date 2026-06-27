/**
 * @file renderer plugin — primitive shape construction.
 *
 * Builds a Pixi display object from a plain {@link PrimitiveSpec} (rect / circle /
 * line / polygon + fill/stroke/alpha/label). Keeps Pixi drawing calls out of api.ts;
 * Pixi stays confined to the renderer's domain files (type seam unchanged).
 */
import type { Container } from "pixi.js";
import type { PrimitiveSpec } from "./types";

/**
 * Build a Pixi Graphics for the given primitive spec.
 *
 * @param _spec - Plain, JSON-describable shape + style spec.
 * @throws {Error} Always — skeleton stub; implemented by the renderer build wave.
 * @example
 * ```ts
 * const view = buildPrimitive({ shape: "circle", radius: 10, fill: 0xff0000, label: "ball" });
 * ```
 */
export const buildPrimitive = (_spec: PrimitiveSpec): Container => {
  throw new Error("not implemented");
};

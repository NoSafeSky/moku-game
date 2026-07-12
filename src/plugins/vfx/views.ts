/**
 * @file vfx plugin — Pixi view construction (floating text).
 *
 * Keeps the sole Pixi `Text` construction out of api.ts so Pixi stays confined
 * to the vfx domain files. Particles are built by the renderer's `attachPrimitive`
 * (Graphics) — the only view vfx builds itself is the floating-text `Text`, whose
 * alpha it fades per frame (the renderer's sync system does not touch alpha).
 */
import type { Container } from "pixi.js";
import { Text } from "pixi.js";

/** Plain-data options for {@link buildText} — no Pixi types. */
export type TextViewSpec = {
  /** The string to render. */
  text: string;
  /** Fill color, hex int. */
  color: number;
  /** Font size, px. */
  fontSize: number;
  /** Initial alpha, 0..1. */
  alpha: number;
};

/**
 * Build a centered Pixi `Text` for a floating number/text, returned as a
 * `Container` so callers stay decoupled from the Pixi class hierarchy.
 *
 * The text is anchored at its center (`anchor 0.5`) so it sits on the entity's
 * Transform, and its initial alpha is applied here (the floating system fades it
 * from there).
 *
 * @param spec - Plain-data text + style + initial alpha.
 * @returns A Pixi `Text` (as `Container`) ready to `attach` to the renderer.
 * @example
 * ```ts
 * const view = buildText({ text: "+50", color: 0xffffff, fontSize: 16, alpha: 1 });
 * renderer.attach(entity, view);
 * ```
 */
export const buildText = (spec: TextViewSpec): Container => {
  const view = new Text({
    text: spec.text,
    style: { fontSize: spec.fontSize, fill: spec.color }
  });
  view.anchor.set(0.5);
  view.alpha = spec.alpha;
  return view;
};

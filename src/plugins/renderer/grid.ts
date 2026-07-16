/**
 * @file renderer plugin — editor grid overlay construction (setGridVisible).
 *
 * Draws hairlines every `size` px across the canvas extent onto a renderer-owned
 * `Graphics` node. Kept out of api.ts so Pixi drawing calls stay confined to the
 * renderer's domain files, mirroring primitives.ts's `drawShape`.
 */
import type { Graphics } from "pixi.js";
import type { GridSpec } from "./types";

/** Default grid cell size in world px, used when `spec.size` is omitted. */
export const DEFAULT_GRID_SIZE = 32;

/** Default grid line color — a slate hairline — used when `spec.color` is omitted. */
export const DEFAULT_GRID_COLOR = 0x33_41_55;

/**
 * (Re)draw grid hairlines across the given canvas extent onto `grid`.
 *
 * Clears any previous drawing first so repeated calls (e.g. restyling on a
 * subsequent `setGridVisible(true, spec)`) do not accumulate stale lines.
 *
 * @param grid - The Graphics node to draw onto.
 * @param width - Canvas width in px (the grid's horizontal extent).
 * @param height - Canvas height in px (the grid's vertical extent).
 * @param spec - Optional cell size + line color overrides.
 * @example
 * ```ts
 * drawGrid(grid, 800, 600, { size: 16, color: 0x334155 });
 * ```
 */
export const drawGrid = (grid: Graphics, width: number, height: number, spec?: GridSpec): void => {
  const size = spec?.size ?? DEFAULT_GRID_SIZE;
  const color = spec?.color ?? DEFAULT_GRID_COLOR;

  grid.clear();
  for (let x = 0; x <= width; x += size) {
    grid.moveTo(x, 0).lineTo(x, height);
  }
  for (let y = 0; y <= height; y += size) {
    grid.moveTo(0, y).lineTo(width, y);
  }
  grid.stroke({ color, width: 1 });
};

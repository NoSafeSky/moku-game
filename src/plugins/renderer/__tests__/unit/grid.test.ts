/**
 * @file renderer plugin — unit tests for drawGrid (Phase-1, setGridVisible).
 *
 * drawGrid takes a structural Graphics-like target so no "pixi.js" mock is
 * needed — only the fluent methods it actually calls (clear/moveTo/lineTo/stroke)
 * are stubbed.
 */

import type { Graphics } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_GRID_COLOR, DEFAULT_GRID_SIZE, drawGrid } from "../../grid";

/** Build a chainable Graphics-like stub (moveTo/lineTo return `this` in real Pixi). */
const makeGridStub = () => {
  const stub = {
    clear: vi.fn(() => stub),
    moveTo: vi.fn(() => stub),
    lineTo: vi.fn(() => stub),
    stroke: vi.fn(() => stub)
  };
  return stub;
};

describe("drawGrid", () => {
  it("clears the graphics before drawing", () => {
    const grid = makeGridStub();

    drawGrid(grid as unknown as Graphics, 64, 64);

    expect(grid.clear).toHaveBeenCalledOnce();
  });

  it("draws a vertical + horizontal line at every default-size step across the extent", () => {
    const grid = makeGridStub();

    drawGrid(grid as unknown as Graphics, 64, 64);

    // width=64, height=64, default size=32 → x/y steps at 0, 32, 64 (3 each)
    expect(grid.moveTo).toHaveBeenCalledTimes(6);
    expect(grid.moveTo).toHaveBeenCalledWith(0, 0);
    expect(grid.moveTo).toHaveBeenCalledWith(32, 0);
    expect(grid.moveTo).toHaveBeenCalledWith(64, 0);
    expect(grid.moveTo).toHaveBeenCalledWith(0, 32);
    expect(grid.moveTo).toHaveBeenCalledWith(0, 64);
  });

  it("strokes with the default size + slate-hairline color when spec is omitted", () => {
    const grid = makeGridStub();

    drawGrid(grid as unknown as Graphics, 32, 32);

    expect(grid.stroke).toHaveBeenCalledWith({ color: DEFAULT_GRID_COLOR, width: 1 });
    expect(DEFAULT_GRID_SIZE).toBe(32);
  });

  it("uses spec.size to control line spacing", () => {
    const grid = makeGridStub();

    drawGrid(grid as unknown as Graphics, 20, 20, { size: 10 });

    // width=20, height=20, size=10 → steps at 0, 10, 20 (3 each) = 6 moveTo calls
    expect(grid.moveTo).toHaveBeenCalledTimes(6);
  });

  it("uses spec.color to override the stroke color", () => {
    const grid = makeGridStub();

    drawGrid(grid as unknown as Graphics, 32, 32, { color: 0xff_00_00 });

    expect(grid.stroke).toHaveBeenCalledWith({ color: 0xff_00_00, width: 1 });
  });
});

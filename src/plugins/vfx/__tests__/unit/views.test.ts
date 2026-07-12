/**
 * @file vfx plugin — buildText unit tests.
 *
 * Verifies the sole Pixi `Text` construction: the requested text + style reach the
 * Text, it is centered (`anchor 0.5`), and its initial alpha is applied.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("pixi.js", () => ({
  Text: class {
    anchor = { set: vi.fn() };
    alpha = 1;
    constructor(public options: unknown) {}
  }
}));

import { buildText } from "../../views";

type TextStub = {
  anchor: { set: ReturnType<typeof vi.fn> };
  alpha: number;
  options: { text: string; style: { fontSize: number; fill: number } };
};

describe("buildText", () => {
  it("builds a centered Text carrying the given text, style, and alpha", () => {
    const view = buildText({
      text: "+50",
      color: 0xff_00_00,
      fontSize: 20,
      alpha: 0.8
    }) as unknown as TextStub;

    expect(view.anchor.set).toHaveBeenCalledWith(0.5);
    expect(view.alpha).toBe(0.8);
    expect(view.options.text).toBe("+50");
    expect(view.options.style.fontSize).toBe(20);
    expect(view.options.style.fill).toBe(0xff_00_00);
  });
});

/**
 * @file ui plugin — widget builder unit tests.
 *
 * Builds each widget kind directly (real Pixi objects — no GPU needed) and asserts
 * node shape, resolved style, absolute hit-rects (including nested-panel offset
 * accumulation and anchor shifts), and the bar fill sized to `value/max`.
 */
import { Container, Graphics, Text } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { buildScreen } from "../../widgets";
import { makeConfig } from "../helpers";

/** Build a one-widget screen and return the top-level node + build result. */
const buildOne = (spec: Parameters<typeof buildScreen>[0]["widgets"][number]) => {
  const config = makeConfig();
  let id = 1;
  const result = buildScreen({ widgets: [spec] }, config, () => id++);
  return { ...result, node: result.container.children[0], config };
};

describe("ui widgets", () => {
  it("builds a label as a Text with resolved color/size and anchor", () => {
    const { node, byId } = buildOne({
      id: "score",
      kind: "label",
      text: "Score",
      color: 0xff_00_00,
      fontSize: 30,
      x: 40,
      y: 8
    });

    expect(node).toBeInstanceOf(Text);
    const text = node as Text;
    expect(text.text).toBe("Score");
    expect(text.style.fontSize).toBe(30);
    expect(text.anchor.x).toBeCloseTo(0.5, 6); // default label anchor
    expect(text.position.x).toBe(40);
    expect(byId.get("score")?.kind).toBe("label");
  });

  it("falls back to the config theme when a label omits style fields", () => {
    const { node } = buildOne({ kind: "label", text: "HP" }); // no color/fontSize/fontFamily
    expect((node as Text).style.fontSize).toBe(20); // config.fontSize default
  });

  it("builds a button as bg Graphics + Text with an explicit hit-rect", () => {
    const { node, buttons } = buildOne({
      kind: "button",
      text: "Play",
      onTap: vi.fn(),
      width: 200,
      height: 56,
      x: 100,
      y: 50
    });

    expect(node).toBeInstanceOf(Container);
    expect((node as Container).children.length).toBe(2); // bg + caption
    expect((node as Container).children[0]).toBeInstanceOf(Graphics);
    expect((node as Container).children[1]).toBeInstanceOf(Text);

    // Default anchor {0.5,0.5}: rect origin = position − anchor·size.
    expect(buttons[0]?.rect).toEqual({ x: 0, y: 22, w: 200, h: 56 });
  });

  it("estimates a button hit-rect from its text when width/height are omitted", () => {
    const { buttons } = buildOne({ kind: "button", text: "OK", onTap: vi.fn() });

    // w = ceil(2·20·0.6) + 2·12 = 48 ; h = ceil(20) + 2·12 = 44
    expect(buttons[0]?.rect.w).toBe(48);
    expect(buttons[0]?.rect.h).toBe(44);
  });

  it("positions panel children relative to the panel origin (rect accumulates offset)", () => {
    const { node, buttons } = buildOne({
      kind: "panel",
      x: 250,
      y: 200,
      width: 300,
      height: 200,
      radius: 12,
      children: [
        { kind: "button", text: "Resume", x: 150, y: 130, width: 180, height: 48, onTap: vi.fn() }
      ]
    });

    // Panel node = bg Graphics + one child button node.
    expect((node as Container).children.length).toBe(2);
    // Panel origin (250,200) + child (150,130) − anchor{0.5}·(180,48) = (310, 306).
    expect(buttons[0]?.rect).toEqual({ x: 310, y: 306, w: 180, h: 48 });
  });

  it("builds a bar as track + fill scaled to value/max", () => {
    const { node } = buildOne({ kind: "bar", value: 25, max: 100, width: 160, height: 12 });

    const children = (node as Container).children;
    expect(children.length).toBe(2); // track + fill
    expect(children[1]?.scale.x).toBeCloseTo(0.25, 6);
  });

  it("clamps an over-max bar value to a full fill", () => {
    const { node } = buildOne({ kind: "bar", value: 150, max: 100, width: 160, height: 12 });
    expect((node as Container).children[1]?.scale.x).toBeCloseTo(1, 6);
  });

  it("shifts the hit-rect and pivot for a top-left anchor", () => {
    const { node, buttons } = buildOne({
      kind: "button",
      text: "X",
      onTap: vi.fn(),
      width: 100,
      height: 40,
      x: 10,
      y: 10,
      anchor: { x: 0, y: 0 }
    });

    expect((node as Container).pivot.x).toBe(0);
    expect(buttons[0]?.rect).toEqual({ x: 10, y: 10, w: 100, h: 40 });
  });

  it("registers a backdrop rect sized to the config viewport", () => {
    const config = makeConfig({ width: 1024, height: 768 });
    let id = 1;
    const { container } = buildScreen({ backdrop: {}, widgets: [] }, config, () => id++);

    const backdrop = container.children[0];
    expect(backdrop).toBeInstanceOf(Graphics);
    expect((backdrop as Graphics).width).toBeCloseTo(1024, 0);
    expect((backdrop as Graphics).height).toBeCloseTo(768, 0);
  });
});

/**
 * @file renderer plugin — unit tests for buildSpriteView (Phase-1, attachSprite).
 *
 * Tests cover:
 *   - Unresolved alias (no resolver / resolver returns undefined) builds a
 *     placeholder Graphics child, sized from spec.width/height or the default box.
 *   - Resolved alias (resolver returns a TextureHandle) builds a Sprite child,
 *     centered (anchor 0.5), with tint/width/height applied to the CHILD.
 *   - flipX sets the child's scale.x to -1 without touching the wrapper.
 *   - The wrapper is a plain Container holding exactly the one child, ready for
 *     stage.addChild + views.set — it carries no view-local visuals itself.
 *
 * "pixi.js" is mocked at module level with lightweight stub classes (no GPU).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("pixi.js", () => {
  class Graphics {
    rect = vi.fn();
    fill = vi.fn();
    scale = { x: 1, y: 1 };
    tint: number | string = 0xff_ff_ff;
    label = "";
  }
  class Sprite {
    texture: unknown;
    anchor = { set: vi.fn() };
    scale = { x: 1, y: 1 };
    tint: number | string = 0xff_ff_ff;
    width = 0;
    height = 0;
    constructor(texture: unknown) {
      this.texture = texture;
    }
  }
  class Container {
    children: unknown[] = [];
    scale = { x: 1, y: 1 };
    /** Records the child and returns it, matching Pixi's real addChild contract. */
    addChild(child: unknown): unknown {
      this.children.push(child);
      return child;
    }
  }
  return { Graphics, Sprite, Container };
});

// ─────────────────────────────────────────────────────────────────────────────
// Imports after the mock is declared
// ─────────────────────────────────────────────────────────────────────────────

import { Container, Graphics, Sprite } from "pixi.js";
import { buildSpriteView } from "../../sprites";
import type { SpriteSpec, TextureHandle } from "../../types";

/** Build a fake opaque TextureHandle for tests (the internal cast target is a mock). */
const makeHandle = (): TextureHandle => ({}) as TextureHandle;

// ─────────────────────────────────────────────────────────────────────────────
// Unresolved alias — placeholder Graphics
// ─────────────────────────────────────────────────────────────────────────────

describe("buildSpriteView — unresolved alias (placeholder)", () => {
  it("builds a placeholder Graphics child when no resolver is given", () => {
    const wrapper = buildSpriteView({ alias: "missing" }, undefined);
    const child = (wrapper as unknown as { children: unknown[] }).children[0];

    expect(child).toBeInstanceOf(Graphics);
  });

  it("builds a placeholder Graphics child when the resolver returns undefined", () => {
    const resolve = vi.fn().mockReturnValue(undefined);
    const wrapper = buildSpriteView({ alias: "not-loaded-yet" }, resolve);
    const child = (wrapper as unknown as { children: unknown[] }).children[0];

    expect(resolve).toHaveBeenCalledWith("not-loaded-yet");
    expect(child).toBeInstanceOf(Graphics);
  });

  it("sizes the placeholder box from spec.width/height", () => {
    const wrapper = buildSpriteView({ alias: "missing", width: 64, height: 48 }, undefined);
    const child = (wrapper as unknown as { children: [Graphics] }).children[0];

    expect(child.rect).toHaveBeenCalledWith(-32, -24, 64, 48);
  });

  it("falls back to a default 32x32 box when width/height are omitted", () => {
    const wrapper = buildSpriteView({ alias: "missing" }, undefined);
    const child = (wrapper as unknown as { children: [Graphics] }).children[0];

    expect(child.rect).toHaveBeenCalledWith(-16, -16, 32, 32);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Resolved alias — Sprite, centered, view-local visuals on the child
// ─────────────────────────────────────────────────────────────────────────────

describe("buildSpriteView — resolved alias (Sprite)", () => {
  it("builds a Sprite child when the resolver returns a handle", () => {
    const handle = makeHandle();
    const resolve = vi.fn().mockReturnValue(handle);
    const wrapper = buildSpriteView({ alias: "player" }, resolve);
    const child = (wrapper as unknown as { children: unknown[] }).children[0];

    expect(resolve).toHaveBeenCalledWith("player");
    expect(child).toBeInstanceOf(Sprite);
  });

  it("centers the sprite (anchor.set(0.5))", () => {
    const resolve = vi.fn().mockReturnValue(makeHandle());
    const wrapper = buildSpriteView({ alias: "player" }, resolve);
    const child = (wrapper as unknown as { children: [Sprite] }).children[0];

    expect(child.anchor.set).toHaveBeenCalledWith(0.5);
  });

  it("applies tint to the CHILD, not the wrapper", () => {
    const resolve = vi.fn().mockReturnValue(makeHandle());
    const spec: SpriteSpec = { alias: "player", tint: 0xff_00_00 };
    const wrapper = buildSpriteView(spec, resolve);
    const child = (wrapper as unknown as { children: [Sprite] }).children[0];

    expect(child.tint).toBe(0xff_00_00);
    expect((wrapper as unknown as { tint?: unknown }).tint).toBeUndefined();
  });

  it("applies width/height to the CHILD", () => {
    const resolve = vi.fn().mockReturnValue(makeHandle());
    const spec: SpriteSpec = { alias: "player", width: 40, height: 60 };
    const wrapper = buildSpriteView(spec, resolve);
    const child = (wrapper as unknown as { children: [Sprite] }).children[0];

    expect(child.width).toBe(40);
    expect(child.height).toBe(60);
  });

  it("leaves tint/width/height untouched when the spec omits them", () => {
    const resolve = vi.fn().mockReturnValue(makeHandle());
    const wrapper = buildSpriteView({ alias: "player" }, resolve);
    const child = (wrapper as unknown as { children: [Sprite] }).children[0];

    expect(child.tint).toBe(0xff_ff_ff); // Pixi's own default, untouched
    expect(child.width).toBe(0); // Pixi's own default, untouched
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// flipX — mirrors the CHILD, wrapper unaffected
// ─────────────────────────────────────────────────────────────────────────────

describe("buildSpriteView — flipX", () => {
  it("sets the child's scale.x to -1 when flipX is true (resolved sprite)", () => {
    const resolve = vi.fn().mockReturnValue(makeHandle());
    const wrapper = buildSpriteView({ alias: "player", flipX: true }, resolve);
    const child = (wrapper as unknown as { children: [Sprite] }).children[0];

    expect(child.scale.x).toBe(-1);
    expect((wrapper as unknown as { scale: { x: number } }).scale.x).toBe(1);
  });

  it("sets the child's scale.x to -1 when flipX is true (placeholder)", () => {
    const wrapper = buildSpriteView({ alias: "missing", flipX: true }, undefined);
    const child = (wrapper as unknown as { children: [Graphics] }).children[0];

    expect(child.scale.x).toBe(-1);
  });

  it("leaves scale.x at its default when flipX is omitted", () => {
    const resolve = vi.fn().mockReturnValue(makeHandle());
    const wrapper = buildSpriteView({ alias: "player" }, resolve);
    const child = (wrapper as unknown as { children: [Sprite] }).children[0];

    expect(child.scale.x).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wrapper shape
// ─────────────────────────────────────────────────────────────────────────────

describe("buildSpriteView — wrapper", () => {
  it("holds exactly one child (the sprite or placeholder)", () => {
    const wrapper = buildSpriteView({ alias: "missing" }, undefined);
    const { children } = wrapper as unknown as { children: unknown[] };

    expect(children).toHaveLength(1);
  });

  it("calls addChild with the built child", () => {
    const addChildSpy = vi.spyOn(Container.prototype, "addChild");
    const resolve = vi.fn().mockReturnValue(makeHandle());

    const wrapper = buildSpriteView({ alias: "player" }, resolve);
    const child = (wrapper as unknown as { children: [Sprite] }).children[0];

    expect(addChildSpy).toHaveBeenCalledWith(child);
    addChildSpy.mockRestore();
  });
});

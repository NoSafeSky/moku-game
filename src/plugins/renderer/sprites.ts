/**
 * @file renderer plugin — sprite + placeholder construction (attachSprite).
 *
 * Builds the wrapper Container + inner Sprite/Graphics child used by attachSprite.
 * Keeps Pixi construction calls out of api.ts; Pixi stays confined to the renderer's
 * domain files. The wrapper is the ONLY node the Transform/world sync writes to
 * (position/rotation/scale) — tint/flipX/width/height live on the CHILD, so the
 * sync never clobbers those view-local visuals.
 */

import type { Texture } from "pixi.js";
import { Container, Graphics, Sprite } from "pixi.js";
import type { SpriteSpec, TextureHandle, TextureResolver } from "./types";

/** Default placeholder box size (px) used when spec provides neither width nor height. */
const DEFAULT_PLACEHOLDER_SIZE = 32;

/** Default placeholder fill color — a neutral gray box standing in for a loading texture. */
const DEFAULT_PLACEHOLDER_COLOR = 0x80_80_80;

/**
 * Build the placeholder box shown while a sprite's texture is unresolved (no
 * resolver installed, or the resolver returned undefined for the alias).
 *
 * Centered on the local origin `(0, 0)` — matches attachPrimitive's `rect` anchor
 * contract, so a placeholder occupies the same space its eventual sprite would.
 *
 * @param spec - Sprite spec supplying the optional width/height.
 * @returns A Graphics box ready to be attachSprite's inner child.
 * @example
 * ```ts
 * const placeholder = buildPlaceholder({ alias: "player" }); // 32x32 gray box
 * ```
 */
const buildPlaceholder = (spec: SpriteSpec): Graphics => {
  const width = spec.width ?? DEFAULT_PLACEHOLDER_SIZE;
  const height = spec.height ?? DEFAULT_PLACEHOLDER_SIZE;
  const box = new Graphics();
  box.rect(-width / 2, -height / 2, width, height);
  box.fill({ color: DEFAULT_PLACEHOLDER_COLOR });
  return box;
};

/**
 * Build the resolved Sprite from an opaque {@link TextureHandle}.
 *
 * The handle is cast internally back to a Pixi `Texture` — this is the ONLY place
 * that cast happens; `Texture` never crosses the renderer's public boundary.
 *
 * @param handle - The opaque texture handle returned by the injected resolver.
 * @param spec - Sprite spec supplying tint/width/height.
 * @returns A Sprite, centered on the local origin, ready to be attachSprite's inner child.
 * @example
 * ```ts
 * const sprite = buildResolvedSprite(handle, { alias: "player", tint: 0xff0000 });
 * ```
 */
const buildResolvedSprite = (handle: TextureHandle, spec: SpriteSpec): Sprite => {
  const texture = handle as unknown as Texture;
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5);
  if (spec.tint !== undefined) sprite.tint = spec.tint;
  if (spec.width !== undefined) sprite.width = spec.width;
  if (spec.height !== undefined) sprite.height = spec.height;
  return sprite;
};

/**
 * Build the wrapper `Container` + inner sprite/placeholder child for `attachSprite`.
 *
 * Resolves `spec.alias` through `resolve` (the injected {@link TextureResolver});
 * an unresolved alias (no resolver, or the resolver returning undefined) falls back
 * to a placeholder box so the entity stays visible while its texture loads. The
 * wrapper carries no view-local visuals itself — only the child does — so the
 * Transform/world sync (which drives only the wrapper's position/rotation/scale)
 * never clobbers `tint`/`flipX`/`width`/`height`.
 *
 * @param spec - Plain sprite spec (alias + view-local visuals).
 * @param resolve - The injected texture resolver, or undefined (placeholder-only mode).
 * @returns The wrapper Container (already holding its one child), ready for
 *   `stage.addChild` + `views.set`.
 * @example
 * ```ts
 * const wrapper = buildSpriteView({ alias: "player" }, state.textureResolver);
 * stage.addChild(wrapper);
 * ```
 */
export const buildSpriteView = (
  spec: SpriteSpec,
  resolve: TextureResolver | undefined
): Container => {
  const wrapper = new Container();
  const handle = resolve?.(spec.alias);
  const child = handle ? buildResolvedSprite(handle, spec) : buildPlaceholder(spec);
  if (spec.flipX) child.scale.x = -1;
  wrapper.addChild(child);
  return wrapper;
};

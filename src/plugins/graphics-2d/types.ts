/**
 * @file graphics-2d plugin — type definitions.
 *
 * The two authorable render components (SpriteRenderer + Shape), the internal view-tracking state,
 * and the public token-getter surface (`app["graphics-2d"]`). Names NO Pixi type — the plugin
 * drives views only through the renderer's plain-data API.
 */
import type { Component, Entity } from "../ecs/types";
import type { PrimitiveSpec, SpriteSpec } from "../renderer/types";

/**
 * graphics-2d configuration. This plugin exposes no tunable knobs — it is a fixed render-component
 * library — so Config is intentionally empty.
 */
export type Config = Record<string, never>;

/**
 * The render seam the sync system drives — the four plain-data renderer methods that build, update,
 * and dispose an entity's view. Declared structurally (rather than importing the renderer's `Api`)
 * so the reconciler depends on exactly what it calls, and so a unit test's mock renderer is a plain
 * object rather than a cast. Every member is Pixi-free: specs in, `boolean`/`void` out.
 */
export type RenderSurface = {
  /** Build + stage a vector primitive view for an entity. Returns `false` when headless. */
  attachPrimitive(entity: Entity, spec: PrimitiveSpec): boolean;
  /** Build + stage a textured sprite view for an entity. Returns `false` when headless. */
  attachSprite(entity: Entity, spec: SpriteSpec): boolean;
  /** Detach + dispose an entity's view. Idempotent, and a safe no-op when headless. */
  detach(entity: Entity): void;
  /** Mark an entity so the renderer's own sync repositions its view next tick. */
  markDirty(entity: Entity): void;
};

/**
 * The minimal assets surface the injected texture resolver reads: alias → the loaded texture, or
 * `undefined` when it is not loaded.
 *
 * The return type is deliberately the opaque `object` — naming the concrete texture type would
 * mean naming a Pixi type, which is exactly the isolation invariant this plugin exists to uphold
 * (Pixi is confined to `renderer`). graphics-2d never dereferences the value; it only forwards it
 * to the renderer as an opaque `TextureHandle`. The real `assets` API satisfies this structurally.
 */
export type TextureLookup = {
  /** The loaded texture for an alias as an opaque value, or `undefined` when it is not loaded. */
  get(alias: string): object | undefined;
};

/** SpriteRenderer component value — a textured sprite built from `assets.get(sprite)`. */
export type SpriteRendererValue = {
  /** Asset alias resolved by the injected texture resolver (empty → placeholder). */
  sprite: string;
  /** Tint color as a `#rrggbb` hex string (`#ffffff` = untinted). */
  tint: string;
  /** Mirror the sprite horizontally. */
  flipX: boolean;
  /** Named sorting layer (authored/serialized; z-order application deferred to P1b). */
  sortingLayer: string;
  /** Order within the sorting layer (authored/serialized; deferred to P1b). */
  orderInLayer: number;
};

/** Shape component value — a vector primitive built via the renderer's `attachPrimitive`. */
export type ShapeValue = {
  /** Primitive kind. */
  kind: "rect" | "circle";
  /** Rectangle width in px (kind: "rect"). */
  width: number;
  /** Rectangle height in px (kind: "rect"). */
  height: number;
  /** Circle radius in px (kind: "circle"). */
  radius: number;
  /** Fill color as a `#rrggbb` hex string. */
  fill: string;
  /** Stroke color as a `#rrggbb` hex string. */
  stroke: string;
  /** Stroke width in px (0 = no stroke). */
  strokeWidth: number;
};

/** Which renderable component backs an entity's tracked view (one view per entity). */
export type RenderableKind = "shape" | "sprite";

/** A tracked view: its backing component kind and a cheap value signature for change detection. */
export type TrackedView = {
  /** The renderable component this entity's view was built from. */
  readonly kind: RenderableKind;
  /** Signature of the component value the current view reflects; a mismatch triggers a rebuild. */
  sig: string;
};

/** graphics-2d plugin state. */
export type State = {
  /** Flipped true at the end of onStart; the API getters throw before it. */
  started: boolean;
  /** The SpriteRenderer component token defined on the ecs world in onStart (undefined before start). */
  spriteToken: Component<SpriteRendererValue> | undefined;
  /** The Shape component token defined on the ecs world in onStart (undefined before start). */
  shapeToken: Component<ShapeValue> | undefined;
  /** Entities this plugin has attached a view for, with the value signature the view reflects. */
  readonly tracked: Map<Entity, TrackedView>;
  /** The world change-epoch observed at the last render-sync run; the system early-outs when unchanged. */
  lastEpoch: number;
};

/** graphics-2d public API surface (`app["graphics-2d"]`). */
export type Api = {
  /** The SpriteRenderer component token defined in onStart. Throws if read before start. */
  readonly SpriteRenderer: Component<SpriteRendererValue>;
  /** The Shape component token defined in onStart. Throws if read before start. */
  readonly Shape: Component<ShapeValue>;
};

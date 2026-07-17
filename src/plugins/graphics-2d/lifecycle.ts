/**
 * @file graphics-2d plugin — onStart lifecycle wiring.
 *
 * Deps-ready wiring — `@no-resource-check` (no owned external resource). Runs after
 * ecs / renderer / reflection / component-registry / assets have started (guaranteed by `depends`)
 * to: define the two render components, register their reflection schemas and Add-Component catalog
 * entries, register the render-sync system, and inject the assets → renderer texture resolver.
 *
 * No `onStop`: every artifact lives on a dependency-owned structure discarded with the app — the
 * component tokens on the world's registry, the sync system on its system list, the resolver in the
 * renderer's slot — and the views themselves are renderer-owned scene data the renderer disposes.
 * Unwiring them would be dead work on objects about to be collected.
 */
import { assetsPlugin } from "../assets";
import { componentRegistryPlugin } from "../component-registry";
import type { Api as ComponentRegistryApi } from "../component-registry/types";
import { ecsPlugin } from "../ecs";
import type { World } from "../ecs/types";
import { reflectionPlugin } from "../reflection";
import type { Api as ReflectionApi } from "../reflection/types";
import { rendererPlugin } from "../renderer";
import type { Api as RendererApi, TextureHandle, TextureResolver } from "../renderer/types";
import { catalogEntries, createShape, createSpriteRenderer } from "./components";
import { shapeSchema, spriteRendererSchema } from "./schemas";
import { createRenderSyncSystem } from "./sync";
import type { State, TextureLookup } from "./types";

/**
 * Structural context required by {@link start} — only the fields onStart accesses, so tests can
 * exercise it without wiring the full kernel.
 *
 * `require(assetsPlugin)` is deliberately declared as returning the narrow {@link TextureLookup}
 * rather than the assets `Api`: the real API satisfies it structurally, and typing the seam this
 * narrowly is what keeps the Pixi `Texture` type from ever being named in this plugin.
 */
export type StartContext = {
  /** graphics-2d plugin state (mutated to store the two tokens + the started flag). */
  readonly state: State;
  /** Require a dependency's API by plugin instance. */
  require: ((plugin: typeof ecsPlugin) => World) &
    ((plugin: typeof rendererPlugin) => RendererApi) &
    ((plugin: typeof reflectionPlugin) => ReflectionApi) &
    ((plugin: typeof componentRegistryPlugin) => ComponentRegistryApi) &
    ((plugin: typeof assetsPlugin) => TextureLookup);
};

/**
 * Builds the alias → texture resolver that bridges `assets` to the `renderer`.
 *
 * This is the ONE cross-plugin data flow carrying a render-backend value, and it carries it
 * OPAQUELY: the loaded texture is re-branded to the renderer's `TextureHandle` and handed straight
 * back, never dereferenced. The renderer casts it to a Pixi `Texture` internally — the mirror of
 * this assertion, and the reason Pixi stays confined to that one plugin. An unloaded alias yields
 * `undefined`, which makes `attachSprite` fall back to its placeholder until the load lands and
 * bumps the change epoch, at which point the reconciler re-attaches.
 *
 * @param lookup - The assets surface to resolve aliases against.
 * @returns A `TextureResolver` for `renderer.setTextureResolver`.
 * @example
 * ```ts
 * renderer.setTextureResolver(createTextureResolver(assets));
 * ```
 */
export const createTextureResolver =
  (lookup: TextureLookup): TextureResolver =>
  (alias: string): TextureHandle | undefined =>
    lookup.get(alias) as TextureHandle | undefined;

/**
 * Starts the graphics-2d plugin: defines the SpriteRenderer + Shape components, registers their
 * reflection schemas and Add-Component catalog entries, registers the render-sync system, and
 * injects the assets → renderer texture resolver.
 *
 * The sync system is registered on the ecs `world.addSystem("sync", …)` rather than through the
 * scheduler facade, so `depends` stays at the five plugins this plugin actually calls — adding a
 * sixth `scheduler` edge for a method the already-required world exposes would be a dead edge.
 *
 * Registration ORDER, not a dependency edge, is what puts this system after `hierarchy`'s
 * world-transform system in the `sync` stage (graphics-2d needs nothing from `hierarchy`, so an
 * edge would be dead). Correctness does not rely on it: both systems only mark entities dirty, and
 * the renderer composes world-space position by PULLING the current transforms at position time.
 *
 * @param ctx - Structural start context (state + require).
 * @param ctx.state - graphics-2d state, filled with the two component tokens.
 * @param ctx.require - Kernel function to obtain dependency APIs.
 * @example
 * ```ts
 * start(ctx); // after ecs / renderer / reflection / component-registry / assets have started
 * ```
 */
export const start = (ctx: StartContext): void => {
  // (1) Define both render components NAMED, so reflection/component-registry/the editor can
  //     address them by name.
  const world = ctx.require(ecsPlugin);
  ctx.state.spriteToken = world.defineComponent(createSpriteRenderer, { name: "SpriteRenderer" });
  ctx.state.shapeToken = world.defineComponent(createShape, { name: "Shape" });

  // (2) Register the typed schemas so the inspector lays these components out and validates writes.
  const reflection = ctx.require(reflectionPlugin);
  reflection.register("SpriteRenderer", spriteRendererSchema);
  reflection.register("Shape", shapeSchema);

  // (3) Register the Add-Component catalog entries the picker offers.
  const registry = ctx.require(componentRegistryPlugin);
  for (const entry of catalogEntries()) registry.register(entry);

  // (4) Register the reconciler, then bridge assets → renderer for sprite textures.
  const renderer = ctx.require(rendererPlugin);
  const assets = ctx.require(assetsPlugin);
  world.addSystem("sync", createRenderSyncSystem({ state: ctx.state, renderer, world }));
  renderer.setTextureResolver(createTextureResolver(assets));

  // (5) Leave the API getters' before-start guard.
  ctx.state.started = true;
};

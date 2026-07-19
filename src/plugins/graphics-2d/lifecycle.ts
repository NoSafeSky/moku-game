/**
 * @file graphics-2d plugin — onStart lifecycle wiring.
 *
 * Deps-ready wiring — `@no-resource-check` (no owned external resource). Runs after
 * ecs / renderer / reflection / component-registry / assets / asset-store have started (guaranteed
 * by `depends`) to: define the two render components, register their reflection schemas and
 * Add-Component catalog entries, register the render-sync system, and inject the
 * assets + asset-store → renderer texture resolver.
 *
 * No `onStop`: every artifact lives on a dependency-owned structure discarded with the app — the
 * component tokens on the world's registry, the sync system on its system list, the resolver in the
 * renderer's slot — and the views themselves are renderer-owned scene data the renderer disposes.
 * Unwiring them would be dead work on objects about to be collected.
 */
import { assetStorePlugin } from "../asset-store";
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
import type { State, StoreLookup, TextureLookup } from "./types";

/**
 * Structural context required by {@link start} — only the fields onStart accesses, so tests can
 * exercise it without wiring the full kernel.
 *
 * `require(assetsPlugin)` and `require(assetStorePlugin)` are deliberately declared as returning the
 * narrow {@link TextureLookup} / {@link StoreLookup} rather than the full plugin APIs: the real APIs
 * satisfy them structurally, and typing the seams this narrowly is what keeps the Pixi `Texture`
 * type (and everything else) from ever being named in this plugin.
 */
export type StartContext = {
  /** graphics-2d plugin state (mutated to store the two tokens + the started flag). */
  readonly state: State;
  /** Require a dependency's API by plugin instance. */
  require: ((plugin: typeof ecsPlugin) => World) &
    ((plugin: typeof rendererPlugin) => RendererApi) &
    ((plugin: typeof reflectionPlugin) => ReflectionApi) &
    ((plugin: typeof componentRegistryPlugin) => ComponentRegistryApi) &
    ((plugin: typeof assetsPlugin) => TextureLookup) &
    ((plugin: typeof assetStorePlugin) => StoreLookup);
};

/**
 * Builds the alias → texture resolver that bridges `assets` + `asset-store` to the `renderer`.
 *
 * This is the ONE cross-plugin data flow carrying a render-backend value, and it carries it
 * OPAQUELY: a loaded texture is re-branded to the renderer's `TextureHandle` and handed straight
 * back, never dereferenced (the renderer casts it to a Pixi `Texture` internally — the mirror of
 * this assertion, and the reason Pixi stays confined to that one plugin). Resolution widens what
 * the Phase-1 `assets.get` alone could reach, in three steps:
 *
 * 1. `assets.get(alias)` present → return it (a manifest asset, or a store asset already loaded —
 *    the fast path, byte-for-byte the Phase-1 behaviour for manifest aliases).
 * 2. else the store holds a live `blob:` url for the alias → JIT-load it under the stable alias
 *    (fire-and-forget `assets.loadUrl(alias, url)`; the load lands out of band) and return
 *    `undefined` so the renderer draws its placeholder until the pending-texture retry re-attaches.
 * 3. else → `undefined` (unknown alias → placeholder).
 *
 * The resolver stays a PURE `alias → handle` function: it never touches `state.pending` (it has no
 * entity — `TextureResolver` is `(alias) => handle`). Marking the pending entity is the sync
 * reconciler's job, since only it knows which entity carries the alias (see the render-sync system).
 * The store contributes only a url STRING; `assets` does the Pixi load — so no Pixi type is named
 * here and `graphics-2d` stays `pixi.js`-free.
 *
 * @param assets - The assets surface: `get` for the fast path, `loadUrl` for the JIT store load.
 * @param store - The asset-store surface: `url` for the alias's live `blob:` url.
 * @returns A `TextureResolver` for `renderer.setTextureResolver`.
 * @example
 * ```ts
 * renderer.setTextureResolver(createTextureResolver(assets, store));
 * ```
 */
export const createTextureResolver =
  (assets: TextureLookup, store: StoreLookup): TextureResolver =>
  (alias: string): TextureHandle | undefined => {
    const loaded = assets.get(alias);
    if (loaded) return loaded as TextureHandle; // fast path — manifest or already-loaded store asset

    // Not loaded yet: if the store holds this alias, JIT-load its blob: url under the stable alias.
    // An unknown alias just stays a placeholder.
    const url = store.url(alias);
    if (url !== undefined) {
      assets.loadUrl(alias, url).catch(() => {
        // Fire-and-forget — the pending-texture retry re-attaches once the load lands; a load error
        // just leaves the renderer's placeholder.
      });
    }

    return undefined;
  };

/**
 * Starts the graphics-2d plugin: defines the SpriteRenderer + Shape components, registers their
 * reflection schemas and Add-Component catalog entries, registers the render-sync system, and
 * injects the assets + asset-store → renderer texture resolver.
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

  // (4) Register the reconciler, then bridge assets + asset-store → renderer for sprite textures.
  //     The sync system reads assets/store to mark + retry pending (JIT-loading) sprites; the
  //     resolver reads them to resolve or JIT-load an alias.
  const renderer = ctx.require(rendererPlugin);
  const assets = ctx.require(assetsPlugin);
  const store = ctx.require(assetStorePlugin);
  world.addSystem(
    "sync",
    createRenderSyncSystem({ state: ctx.state, renderer, world, assets, store })
  );
  renderer.setTextureResolver(createTextureResolver(assets, store));

  // (5) Leave the API getters' before-start guard.
  ctx.state.started = true;
};

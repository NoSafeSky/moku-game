/**
 * @file assets plugin — API factory.
 *
 * Wraps Pixi v8's Assets singleton: load, loadBundle, get, sprite, isLoaded.
 * Emits `assets:loaded` (coarse milestone event) on successful load/bundle.
 * Calls `ctx.require(rendererPlugin)` lazily inside each method to ensure the
 * Pixi Application is initialised before any texture operation — mirrors the
 * scheduler/renderer pattern of a lazy `getX()` helper.
 *
 * Pixi v8 Assets is a singleton tied to the running Application. The renderer
 * plugin owns the Application (onStart/onStop); this plugin has NO onStart/onStop
 * because the Pixi cache lifetime belongs to the renderer's Application.
 */

import type { Sprite as SpriteType, Texture } from "pixi.js";
import { Assets, Sprite } from "pixi.js";
import { rendererPlugin } from "../renderer";
import type { Api, Config, Events, State } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Structural context type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Structural context type required by createApi.
 *
 * Only the fields the API factory actually accesses are included, so unit tests
 * can supply a minimal mock without wiring the full kernel. Mirrors the
 * RendererContext / SchedulerContext pattern used across this framework.
 */
export type AssetsContext = {
  /** Resolved assets plugin configuration. */
  readonly config: Readonly<Config>;
  /** Assets plugin mutable state (loaded alias set). */
  readonly state: State;
  /** Logger injected by logPlugin. */
  readonly log: {
    /** Log at debug level. */
    debug(message: string): void;
    /** Log at info level. */
    info(message: string): void;
    /** Log a warning. */
    warn(message: string): void;
    /** Log an error. */
    error(message: string): void;
  };
  /**
   * Emit a framework event. Typed to the declared `assets:loaded` event only
   * so `createApi` cannot accidentally widen to unknown events.
   */
  emit: <K extends keyof Events>(event: K, payload: Events[K]) => void;
  /**
   * Require a dependency's API by plugin instance. Called lazily in each
   * method body to ensure the renderer (and therefore Pixi Application) is
   * started before any Asset operations run. The return value is intentionally
   * unused — the call exists purely for its ordering side-effect.
   */
  require: (plugin: typeof rendererPlugin) => unknown;
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the URL to pass to Pixi `Assets.load` for a given alias.
 *
 * Resolution order:
 * 1. If `manifest[alias]` exists → use that URL.
 * 2. Otherwise → treat the alias itself as the URL.
 *
 * In both cases, `basePath` is prepended when non-empty.
 *
 * @param alias - The logical asset name.
 * @param config - The resolved plugin configuration.
 * @returns The URL string to pass to `Assets.load`.
 * @example
 * ```ts
 * resolveUrl("ship", { basePath: "assets/", manifest: { ship: "sprites/ship.png" } });
 * // → "assets/sprites/ship.png"
 * ```
 */
const resolveUrl = (alias: string, config: Readonly<Config>): string => {
  const rawUrl = config.manifest[alias] ?? alias;
  return config.basePath ? `${config.basePath}${rawUrl}` : rawUrl;
};

// ─────────────────────────────────────────────────────────────────────────────
// API factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates the assets plugin API surface.
 *
 * Wraps Pixi v8 `Assets` for texture/spritesheet loading and caching. All
 * methods ensure the renderer dependency is present via `ctx.require(rendererPlugin)`
 * (lazy call for ordering). On a successful load the alias is recorded in
 * `ctx.state.loaded` and `assets:loaded` is emitted. On failure behaviour is
 * governed by `config.throwOnError`.
 *
 * @param ctx - Plugin context (structural — only the fields this API uses).
 * @param ctx.config - Resolved assets plugin configuration.
 * @param ctx.state - Plugin state holding the `loaded` alias Set.
 * @param ctx.log - Logger from logPlugin (used for non-fatal error path).
 * @param ctx.emit - Typed emit for `assets:loaded`.
 * @param ctx.require - Kernel require for ensuring renderer is started.
 * @returns The assets plugin API object.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * const texture = await api.load("ship");
 * const sprite = await api.sprite("ship");
 * ```
 */
export const createApi = (ctx: AssetsContext): Api => {
  /**
   * Lazily ensure the renderer plugin is running before any Pixi Assets call.
   * Called for its ordering side-effect — the renderer return value is not used.
   *
   * @example
   * ```ts
   * ensureRenderer(); // guarantees Pixi Application is started before Assets.load
   * ```
   */
  const ensureRenderer = (): void => {
    ctx.require(rendererPlugin);
  };

  return {
    /**
     * Load a single asset by alias. Resolves the alias against the manifest and
     * basePath, delegates to Pixi `Assets.load`, records the alias in
     * `state.loaded`, and emits `assets:loaded` with `kind: "asset"` on success.
     *
     * On failure: if `config.throwOnError` is `true` the error is rethrown;
     * if `false` the error is logged via `ctx.log.error` and the promise
     * resolves `undefined` (escape hatch — do not rely on the undefined value
     * in production; keep the declared return type as `Promise<Texture>`).
     *
     * @param alias - The logical asset name (key in manifest, or a URL).
     * @returns The loaded `Texture`.
     * @throws {Error} If `config.throwOnError` is `true` and the load fails.
     * @example
     * ```ts
     * const texture = await app.assets.load("ship");
     * ```
     */
    async load(alias: string): Promise<Texture> {
      ensureRenderer();
      const url = resolveUrl(alias, ctx.config);

      try {
        const texture = (await Assets.load(url)) as Texture;
        ctx.state.loaded.add(alias);
        ctx.emit("assets:loaded", { alias, kind: "asset" });
        return texture;
      } catch (error) {
        if (ctx.config.throwOnError) {
          throw error;
        }
        ctx.log.error(
          `[game] assets.load("${alias}") failed.\n  Set throwOnError:false silences this; check the URL or network.`
        );
        return undefined as unknown as Texture;
      }
    },

    /**
     * Register and load a named bundle. Calls `Assets.addBundle` to register the
     * alias-to-URL map, then `Assets.loadBundle` to resolve them all. Records
     * each alias key in `state.loaded` and emits `assets:loaded` ONCE with
     * `kind: "bundle"` when the bundle resolves.
     *
     * @param bundle - The bundle identifier (used as the alias for the event).
     * @param entries - Map of alias → URL for the bundle contents.
     * @returns A record of alias → Texture for all entries in the bundle.
     * @example
     * ```ts
     * const textures = await app.assets.loadBundle("ui", { logo: "logo.png", bg: "bg.png" });
     * ```
     */
    async loadBundle(
      bundle: string,
      entries: Readonly<Record<string, string>>
    ): Promise<Record<string, Texture>> {
      ensureRenderer();
      Assets.addBundle(bundle, entries as Record<string, string>);
      const textures = (await Assets.loadBundle(bundle)) as Record<string, Texture>;

      for (const alias of Object.keys(entries)) {
        ctx.state.loaded.add(alias);
      }
      ctx.emit("assets:loaded", { alias: bundle, kind: "bundle" });
      return textures;
    },

    /**
     * Retrieve an already-loaded texture from the Pixi Assets cache by alias.
     * Returns `undefined` if the alias has not been loaded yet — does NOT trigger
     * a load. For just-in-time loading use `load()` or `sprite()`.
     *
     * @param alias - The logical asset name.
     * @returns The cached `Texture`, or `undefined` if not yet loaded.
     * @example
     * ```ts
     * const texture = app.assets.get("ship"); // undefined before load
     * ```
     */
    get(alias: string): Texture | undefined {
      return (Assets.get(alias) as Texture | undefined) ?? undefined;
    },

    /**
     * Build a Pixi `Sprite` from a texture. If the texture is not yet in the
     * Pixi cache the alias is loaded first via `load()`. Resolves to a new
     * `Sprite` backed by the texture.
     *
     * @param alias - The logical asset name.
     * @returns A new Pixi `Sprite` constructed from the texture.
     * @example
     * ```ts
     * const sprite = await app.assets.sprite("ship");
     * app.renderer.getStage()?.addChild(sprite);
     * ```
     */
    async sprite(alias: string): Promise<SpriteType> {
      // Reuse the cached texture when present so a repeat sprite() call does not
      // re-trigger load() (and a spurious assets:loaded). Only a cache miss loads.
      const cached = this.get(alias);
      const texture = cached ?? (await this.load(alias));
      return new Sprite(texture) as unknown as SpriteType;
    },

    /**
     * Return `true` if the alias was successfully loaded this session, `false`
     * otherwise. Backed by `state.loaded`; does NOT consult the Pixi cache.
     *
     * @param alias - The logical asset name.
     * @returns `true` when the alias is in the session `loaded` Set.
     * @example
     * ```ts
     * app.assets.isLoaded("ship"); // false before load, true after
     * ```
     */
    isLoaded(alias: string): boolean {
      return ctx.state.loaded.has(alias);
    }
  };
};

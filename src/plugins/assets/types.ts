/**
 * @file assets plugin — type definitions.
 */
import type { Sprite, Texture } from "pixi.js";

/** assets plugin event contract (payloads must match the framework Events type). */
export type Events = {
  /** Emitted when an asset or bundle finishes loading. */
  "assets:loaded": { alias: string; kind: "asset" | "bundle" };
};

/** assets plugin configuration. */
export type Config = {
  /** Base URL/path prepended to relative aliases. `@default ""` */
  basePath: string;
  /** Manifest of alias → url. `@default {}` */
  manifest: Readonly<Record<string, string>>;
  /** Throw vs log+resolve-null on load failure. `@default true` */
  throwOnError: boolean;
};

/** assets plugin state. */
export type State = {
  /** Aliases loaded this session. */
  readonly loaded: Set<string>;
};

/**
 * One asset in the enumeration surface (the editor's asset-browser panel polls `entries()`):
 * the alias, whether it is loaded this session, and its configured url when one exists in the manifest.
 */
export type AssetEntry = {
  /** The logical asset alias. */
  alias: string;
  /** Whether the alias has been successfully loaded this session. */
  loaded: boolean;
  /** The configured url from `config.manifest`, when the alias is a manifest entry. */
  url?: string;
};

/** assets plugin API. */
export type Api = {
  /** Load one asset by alias; emits assets:loaded on success. */
  load(alias: string): Promise<Texture>;
  /**
   * Load a texture from an explicit url and cache it under `alias` (Pixi v8 object form
   * `Assets.load({ alias, src: url })`), so the cache key is the stable `alias`, not the url
   * string. Records `alias` in `state.loaded` and emits `assets:loaded` on success. The seam
   * that turns an `asset-store` `blob:` url into a Pixi-cached texture addressable by the
   * store's stable alias. Same `throwOnError` path as `load`.
   */
  loadUrl(alias: string, url: string): Promise<Texture>;
  /** Load a named bundle; emits assets:loaded once resolved. */
  loadBundle(
    bundle: string,
    entries: Readonly<Record<string, string>>
  ): Promise<Record<string, Texture>>;
  /** Get an already-loaded texture, or undefined. */
  get(alias: string): Texture | undefined;
  /** Build a Pixi Sprite from a (just-in-time loaded) alias. */
  sprite(alias: string): Promise<Sprite>;
  /** True if the alias has been loaded this session. */
  isLoaded(alias: string): boolean;
  /**
   * Enumerate known assets for the editor's asset-browser: the union of `config.manifest`
   * aliases and `state.loaded` aliases, each flagged `loaded` (and carrying its manifest `url`
   * when configured). A read-only projection of existing state — cheap to poll.
   */
  entries(): readonly AssetEntry[];
  /** The configured alias → url manifest map (a read-only view of `config.manifest`). */
  manifest(): Readonly<Record<string, string>>;
  /** Pixel dimensions of a loaded texture (from the Pixi cache), or `undefined` if not loaded. */
  metadata(alias: string): { width: number; height: number } | undefined;
};

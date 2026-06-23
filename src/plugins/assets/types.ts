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

/** assets plugin API. */
export type Api = {
  /** Load one asset by alias; emits assets:loaded on success. */
  load(alias: string): Promise<Texture>;
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
};

/**
 * @file Framework configuration — Config + Events types, core plugin registration.
 */
import { envPlugin, logPlugin } from "@moku-labs/common";
import { createCoreConfig as createCoreConfigFactory } from "@moku-labs/core";

/**
 * Global configuration shape for the game framework. The framework defines no global
 * config fields — all configuration is per-plugin via `pluginConfigs`.
 */
// biome-ignore lint/complexity/noBannedTypes: framework has no global config fields
export type Config = {};

/**
 * Coarse framework event contract. Hot-path frame work is NOT emitted as kernel events.
 */
export type Events = {
  /** Fired when an asset or bundle finishes loading. */
  "assets:loaded": { alias: string; kind: "asset" | "bundle" };
  /** Fired after a scene's setup completes. */
  "scene:loaded": { name: string };
};

export const coreConfig = createCoreConfigFactory<
  Config,
  Events,
  [typeof logPlugin, typeof envPlugin]
>("game", {
  config: {},
  plugins: [logPlugin, envPlugin] // core plugins → ctx.log + ctx.env on every ctx
});

/**
 * Define a plugin for the game framework. Types are inferred from the spec object —
 * never pass explicit generics.
 *
 * @param name - Unique plugin id (bare, e.g. "ecs").
 * @param spec - Plugin spec (config, createState, api, depends, events, hooks, lifecycle).
 * @returns A typed plugin definition.
 */
export const createPlugin = coreConfig.createPlugin;

/**
 * Assemble a game framework core (Layer 2) from a set of plugins, bound to this framework's
 * `Config` / `Events`. Used internally by `src/index.ts` to build the default framework, and
 * re-exported from the framework entry for **advanced / headless** core assembly — e.g. composing
 * a core from a custom (headless) plugin subset. Most consumers should use `createApp` instead.
 *
 * The first argument carries type information only (unused at runtime); pass an object exposing the
 * framework's bound `createPlugin` — either `coreConfig` here or the exported `createPlugin`.
 *
 * @param coreConfig - Carrier for the bound `createPlugin` type (e.g. `coreConfig` or `{ createPlugin }`).
 * @param options - Framework plugins plus default `pluginConfigs` / `onReady` / `onError`.
 * @returns The framework factory (`createApp` / `createPlugin`).
 * @example
 * ```ts
 * import { createCore, createPlugin } from "game";
 * const { createApp } = createCore({ createPlugin }, { plugins: [ecsPlugin, schedulerPlugin] });
 * ```
 */
export const createCore = coreConfig.createCore;

// Re-export the raw Moku Core config factory (`@moku-labs/core`) for advanced / headless use:
// assemble a bespoke core with a different `Config` / `Events` shape or core-plugin set, then call
// the returned `createCore`. Most consumers use `createApp` (or the re-exported `createCore`) instead.
export { createCoreConfig } from "@moku-labs/core";

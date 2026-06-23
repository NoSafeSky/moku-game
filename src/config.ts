/**
 * @file Framework configuration — Config + Events types, core plugin registration.
 */
import { envPlugin, logPlugin } from "@moku-labs/common";
import { createCoreConfig } from "@moku-labs/core";

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

export const coreConfig = createCoreConfig<Config, Events, [typeof logPlugin, typeof envPlugin]>(
  "game",
  {
    config: {},
    plugins: [logPlugin, envPlugin] // core plugins → ctx.log + ctx.env on every ctx
  }
);

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
 * Assemble the game framework core from its built-in plugins. Used by `src/index.ts`.
 *
 * @param config - The core config from `createCoreConfig`.
 * @param spec - Framework plugins + default `pluginConfigs`.
 * @returns The framework factory (`createApp` / `createPlugin`).
 */
export const createCore = coreConfig.createCore;

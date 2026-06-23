import { envPlugin, logPlugin } from "@moku-labs/common";
import { createCoreConfig } from "@moku-labs/core";

/**
 * Global configuration shape for the framework.
 *
 * @example
 * ```ts
 * type Config = { port: number; host: string };
 * ```
 */
// biome-ignore lint/complexity/noBannedTypes: placeholder for user-defined config
type Config = {};

/**
 * Event contract for the framework.
 *
 * @example
 * ```ts
 * type Events = { "app:ready": { timestamp: number } };
 * ```
 */
// biome-ignore lint/complexity/noBannedTypes: placeholder for user-defined events
type Events = {};

export const coreConfig = createCoreConfig<Config, Events, [typeof logPlugin, typeof envPlugin]>(
  "game",
  {
    config: {},
    plugins: [logPlugin, envPlugin] // core plugins → ctx.log + ctx.env on every ctx
  }
);

export const { createPlugin, createCore } = coreConfig;

/**
 * @file component-registry plugin (Standard tier) — wiring. See the JSDoc on
 * `componentRegistryPlugin` and `README.md`.
 */
import { createPlugin } from "../../config";
import { createApi } from "./api";
import { createState } from "./state";
import type { Config } from "./types";

const defaultConfig: Config = {};

/**
 * component-registry plugin — Standard tier.
 *
 * A pure enumerable catalog of addable components for the inspector's Add-Component picker: one
 * `Map<string, ComponentCatalogEntry>` behind register / list / byCategory / get / has. No world
 * access, no config, no events, no lifecycle, empty `depends` — domain plugins (graphics-2d)
 * require it to register their components; editor-bridge requires it to list them. Emits no
 * events.
 *
 * @see README.md
 */
export const componentRegistryPlugin = createPlugin("component-registry", {
  config: defaultConfig,
  createState,
  api: createApi
});

export type { ComponentCatalogEntry, ComponentCategory } from "./types";

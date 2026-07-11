/**
 * Storage plugin — Standard tier.
 *
 * Namespaced, versioned key/value save/persistence with a migration chain and a
 * safe localStorage-or-memory default behind a pluggable `StorageBackend` seam.
 * `get`/`set` never throw. No events, no hooks, no lifecycle — there is no
 * resource to manage, and migration is lazy so a `platform`-injected backend is
 * migrated correctly.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { createApi } from "./api";
import { createState } from "./state";
import type { Config } from "./types";

const defaultConfig: Config = {
  namespace: "game",
  version: 1,
  migrations: {}
};

/**
 * Storage plugin instance — Standard tier.
 *
 * Foundational (Wave 1), no game-plugin dependencies and no new package
 * dependency. The `platform` plugin (built later, depends on storage) injects a
 * CrazyGames-data-API backend via `app.storage.setBackend()`; storage owns the
 * seam and the safe default.
 *
 * @see README.md
 */
export const storagePlugin = createPlugin("storage", {
  config: defaultConfig,
  createState,
  api: createApi
  // No events / hooks / onStart / onStop — pure, resource-free persistence API.
});

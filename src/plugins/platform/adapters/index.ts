/**
 * @file platform adapters — the resolver/registry.
 *
 * Maps a resolved {@link Portal} to its concrete {@link PortalAdapter} factory.
 * Adding a portal is a single entry here + one adapter file; the public API stays
 * portal-agnostic. An unknown/unsupported portal resolves to the inert `noop`
 * adapter — the safe default for local dev.
 */
import type { Portal, PortalAdapter } from "../types";
import { createCrazyGamesAdapter } from "./crazygames";
import { createNewgroundsAdapter } from "./newgrounds";
import { createNoopAdapter } from "./noop";
import { createPokiAdapter } from "./poki";

/**
 * Build the adapter for a resolved portal. Unknown portals fall back to the inert
 * `noop` adapter.
 *
 * @param portal - The resolved portal identity.
 * @returns A fresh {@link PortalAdapter} for that portal.
 * @example
 * ```ts
 * const adapter = selectAdapter("crazygames"); // → CrazyGames adapter
 * const dev = selectAdapter("none");           // → inert no-op adapter
 * ```
 */
export const selectAdapter = (portal: Portal): PortalAdapter => {
  switch (portal) {
    case "crazygames": {
      return createCrazyGamesAdapter();
    }
    case "poki": {
      return createPokiAdapter();
    }
    case "newgrounds": {
      return createNewgroundsAdapter();
    }
    default: {
      return createNoopAdapter();
    }
  }
};

export { createCrazyGamesAdapter } from "./crazygames";
export { createNewgroundsAdapter } from "./newgrounds";
export { createNoopAdapter } from "./noop";
export { createPokiAdapter } from "./poki";

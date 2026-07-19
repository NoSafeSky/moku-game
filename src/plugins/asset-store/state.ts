/**
 * @file asset-store plugin — state factory skeleton.
 *
 * Returns a valid, empty state (default backend + empty urls/meta maps, ready:false) so the
 * framework composes cleanly. The F1 build wave keeps this shape and fills the real backend +
 * re-hydration; the durable data (blobs) lives in the backend, never in serialized state.
 */
import { createDefaultBackend } from "./backend";
import type { Config, State } from "./types";

/**
 * Creates initial asset-store plugin state — empty urls/meta maps + the default backend, ready:false.
 *
 * @param ctx - Minimal context with global and config.
 * @param ctx.global - Global plugin registry (unused here).
 * @param ctx.config - Resolved plugin configuration (seeds the backend + accept guard).
 * @returns The initial {@link State} — empty urls/meta, default backend, `ready: false`.
 * @example
 * ```ts
 * const state = createState({ global: {}, config: { dbName: "moku-assets", storeName: "assets", accept: ["image/"] } });
 * ```
 */
export function createState(ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State {
  return {
    backend: createDefaultBackend(ctx.config),
    urls: new Map(),
    meta: new Map(),
    accept: ctx.config.accept,
    ready: false
  };
}

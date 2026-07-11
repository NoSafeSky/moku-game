/**
 * @file storage plugin — state factory.
 */
import { createDefaultBackend } from "./backend";
import type { Config, State } from "./types";

/**
 * Creates the initial storage plugin state.
 *
 * Seeds `namespace` / `version` / `migrations` straight from config, installs the
 * safe default backend (localStorage-or-memory — the probe runs here), and starts
 * `migrated: false` so the migration chain runs lazily on first access. There is
 * no `ctx.global` WeakMap: with no lifecycle to manage, the active backend lives
 * directly on State (unlike `audio`, which parks its live AudioContext in a
 * WeakMap because it has onStart/onStop).
 *
 * `createState` receives no logger, so the degraded-mode "in-memory fallback"
 * notice is deferred to the API's first-access path (which has `ctx.log`).
 *
 * @param ctx - Minimal context providing the global registry and resolved config.
 * @param ctx.global - Global plugin registry (unused; the backend lives on State).
 * @param ctx.config - Resolved storage configuration (namespace, version, migrations).
 * @returns The initial {@link State} object for this plugin instance.
 * @example
 * ```ts
 * const state = createState({ global: {}, config: { namespace: "game", version: 1, migrations: {} } });
 * // → { backend: <default>, namespace: "game", version: 1, migrations: {}, migrated: false }
 * ```
 */
export const createState = (ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State => ({
  backend: createDefaultBackend(),
  namespace: ctx.config.namespace,
  version: ctx.config.version,
  migrations: ctx.config.migrations,
  migrated: false
});

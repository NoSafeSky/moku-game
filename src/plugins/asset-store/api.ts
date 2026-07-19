/**
 * @file asset-store plugin — API factory.
 *
 * The public `app["asset-store"]` surface: import/url/has/get/entries/remove. `url`/`has`/
 * `entries` are synchronous reads of the in-memory `urls`/`meta` maps (hydrated at `onStart`, kept
 * in lockstep by `import`/`remove`); `import`/`get`/`remove` are async (they touch the backend).
 * Every backend call is defensively wrapped so no method ever throws, even against a misbehaving
 * backend — mirrors the `storage` plugin's safe-by-construction API.
 */
import type {
  Api,
  BlobLike,
  Events,
  ImportOptions,
  State,
  StoredAsset,
  StoredRecord
} from "./types";
import { mintObjectUrl, revokeObjectUrl } from "./url";

// ─────────────────────────────────────────────────────────────────────────────
// Structural context type (only the fields the API factory accesses)
// ─────────────────────────────────────────────────────────────────────────────

/** Shared minimal logger surface (from `logPlugin`) used by the accept-guard / failed-write notices. */
export type Log = {
  /** Log a warning (a rejected import or a failed persist). */
  warn(message: string): void;
};

/**
 * Structural context type required by {@link createApi}, so unit tests can pass a minimal mock
 * without wiring the full kernel. Mirrors the `AudioApiContext` / `StorageApiContext` pattern.
 */
export type AssetStoreApiContext = {
  /** asset-store plugin state — backend, urls/meta maps, accept guard, ready flag. */
  readonly state: State;
  /** Logger from logPlugin (the accept-guard + failed-write notices). */
  readonly log: Log;
  /**
   * Emit a declared asset-store event with its typed payload. Written as a method signature
   * (bivariant params) so the kernel's merged `ctx.emit` — which also carries the framework-level
   * events — is assignable to this narrower asset-store-only view when the API factory is wired
   * via `api: ctx => createApi(ctx)`.
   *
   * @param event - The asset-store event name.
   * @param payload - The event payload, matching the declared shape.
   */
  emit<K extends keyof Events>(event: K, payload: Events[K]): void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whether `mime` matches one of the configured accept prefixes.
 *
 * @param mime - The blob's MIME type.
 * @param accept - The configured accept-prefix list.
 * @returns `true` when `mime` starts with any prefix in `accept`.
 * @example
 * ```ts
 * isAccepted("image/png", ["image/"]); // true
 * ```
 */
const isAccepted = (mime: string, accept: readonly string[]): boolean =>
  accept.some(prefix => mime.startsWith(prefix));

/**
 * Slugify a display name into a key-safe token (lowercased, non-alphanumeric runs collapsed to a
 * single hyphen, leading/trailing hyphens trimmed). Falls back to `"asset"` when nothing survives.
 *
 * @param name - The display name to slugify.
 * @returns The slug, or `"asset"` when `name` has no alphanumeric characters.
 * @example
 * ```ts
 * slugify("My Sprite.png"); // "my-sprite-png"
 * ```
 */
const slugify = (name: string): string => {
  const slug = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replace(/^-/, "")
    .replace(/-$/, "");
  return slug || "asset";
};

/** Monotonic counter backing {@link nextAliasSuffix} — guarantees uniqueness within a session. */
let aliasSuffixCounter = 0;

/**
 * Generate a short, session-unique alias suffix from the current time plus an incrementing
 * counter. Deliberately NOT a pseudo-random generator — alias uniqueness is a collision-avoidance
 * hint (not a security token), and a counter is both simpler and unambiguous.
 *
 * @returns A short base-36 suffix, unique within this session.
 * @example
 * ```ts
 * nextAliasSuffix(); // "m3k2p1a"
 * ```
 */
const nextAliasSuffix = (): string => {
  aliasSuffixCounter += 1;
  return `${Date.now().toString(36)}${aliasSuffixCounter.toString(36)}`;
};

/**
 * Derive a stable, unique alias from a display name: a slug of `name` plus a short suffix,
 * regenerated on the rare collision against `meta`'s existing keys.
 *
 * @param name - The display name to derive from.
 * @param meta - The existing alias → metadata map (collision check).
 * @returns A unique alias not present in `meta`.
 * @example
 * ```ts
 * deriveAlias("My Sprite.png", state.meta); // "my-sprite-png-m3k2p1a"
 * ```
 */
const deriveAlias = (name: string, meta: ReadonlyMap<string, unknown>): string => {
  const slug = slugify(name);

  let alias = `${slug}-${nextAliasSuffix()}`;
  while (meta.has(alias)) alias = `${slug}-${nextAliasSuffix()}`;
  return alias;
};

/**
 * Persist a record, degrading a throwing/rejecting backend to a failed write.
 *
 * @param state - The plugin state (holds the active backend).
 * @param record - The record to persist.
 * @returns `true` on success, `false` otherwise.
 * @example
 * ```ts
 * const ok = await safePut(state, record);
 * ```
 */
const safePut = async (state: State, record: StoredRecord): Promise<boolean> => {
  try {
    return await state.backend.put(record);
  } catch {
    return false;
  }
};

/**
 * Read a record by alias, degrading a throwing/rejecting backend to "absent".
 *
 * @param state - The plugin state (holds the active backend).
 * @param alias - The alias to read.
 * @returns The stored record, or `undefined`.
 * @example
 * ```ts
 * const record = await safeGet(state, "sprite-m3k2p1a");
 * ```
 */
const safeGet = async (state: State, alias: string): Promise<StoredRecord | undefined> => {
  try {
    return await state.backend.get(alias);
  } catch {
    return undefined;
  }
};

/**
 * Delete a record by alias; a throwing/rejecting backend is swallowed (best-effort).
 *
 * @param state - The plugin state (holds the active backend).
 * @param alias - The alias to delete.
 * @example
 * ```ts
 * await safeDelete(state, "sprite-m3k2p1a");
 * ```
 */
const safeDelete = async (state: State, alias: string): Promise<void> => {
  try {
    await state.backend.delete(alias);
  } catch {
    // Best-effort removal — never throw.
  }
};

/**
 * Project one `state.meta` entry (plus its `state.urls` counterpart) into a {@link StoredAsset}.
 *
 * @param state - The plugin state (urls map is read for the matching alias).
 * @param alias - The asset's alias.
 * @param meta - The cached metadata for `alias`.
 * @param meta.name - Display name (original file name).
 * @param meta.mime - MIME type, e.g. "image/png".
 * @param meta.byteLength - Byte length of the stored blob.
 * @returns The read-only projection {@link entries} returns.
 * @example
 * ```ts
 * toStoredAsset(state, "sprite-1", { name: "sprite.png", mime: "image/png", byteLength: 2048 });
 * ```
 */
const toStoredAsset = (
  state: State,
  alias: string,
  meta: { name: string; mime: string; byteLength: number }
): StoredAsset => ({
  alias,
  name: meta.name,
  mime: meta.mime,
  byteLength: meta.byteLength,
  url: state.urls.get(alias)
});

// ─────────────────────────────────────────────────────────────────────────────
// API factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates the asset-store plugin API surface.
 *
 * @param ctx - Plugin context (structural — only the fields this API uses).
 * @param ctx.state - The plugin state (backend, urls/meta maps, accept, ready).
 * @param ctx.log - Logger from logPlugin.
 * @param ctx.emit - Typed emit for the asset-store events.
 * @returns The asset-store plugin {@link Api} object.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * const asset = await api.import(blob, { name: "sprite.png" });
 * ```
 */
export const createApi = (ctx: AssetStoreApiContext): Api => {
  const { state } = ctx;

  return {
    /**
     * Persist an imported blob under a stable alias, mint a session `blob:` URL, and emit
     * `asset-store:imported`. Rejects (logs + returns without persisting) when the blob's `type`
     * matches no `config.accept` prefix, or when the backend write fails. Never throws.
     *
     * @param blob - The blob to import.
     * @param opts - Optional alias / display name.
     * @returns The stored-asset projection (`url: undefined` when the import was rejected).
     * @example
     * ```ts
     * const asset = await api.import(blob, { name: "sprite.png" });
     * ```
     */
    async import(blob: BlobLike, opts: ImportOptions = {}): Promise<StoredAsset> {
      const name = opts.name ?? "asset";
      const mime = blob.type;
      const byteLength = blob.size;
      const alias = opts.alias ?? deriveAlias(name, state.meta);

      if (!isAccepted(mime, state.accept)) {
        ctx.log.warn(
          `[asset-store] import("${name}") rejected — mime "${mime}" matches no accept prefix.`
        );
        return { alias, name, mime, byteLength, url: undefined };
      }

      const record: StoredRecord = { alias, name, mime, blob };
      const persisted = await safePut(state, record);
      if (!persisted) {
        ctx.log.warn(`[asset-store] import("${name}") failed — the backend rejected the write.`);
        return { alias, name, mime, byteLength, url: undefined };
      }

      state.meta.set(alias, { name, mime, byteLength });
      const url = mintObjectUrl(blob);
      if (url !== undefined) state.urls.set(alias, url);

      ctx.emit("asset-store:imported", { alias, mime, byteLength });
      return { alias, name, mime, byteLength, url };
    },

    /**
     * The live `blob:` URL for an alias this session, or `undefined` if unknown. Synchronous.
     *
     * @param alias - The asset's alias.
     * @returns The minted `blob:` URL, or `undefined`.
     * @example
     * ```ts
     * api.url("sprite-1"); // "blob:http://…/…" | undefined
     * ```
     */
    url(alias: string): string | undefined {
      return state.urls.get(alias);
    },

    /**
     * Whether the store holds an asset under this alias. Synchronous.
     *
     * @param alias - The asset's alias.
     * @returns `true` when present.
     * @example
     * ```ts
     * api.has("sprite-1");
     * ```
     */
    has(alias: string): boolean {
      return state.meta.has(alias);
    },

    /**
     * Read the persisted blob for an alias, or `undefined` if absent. Never throws.
     *
     * @param alias - The asset's alias.
     * @returns The persisted blob, or `undefined`.
     * @example
     * ```ts
     * const blob = await api.get("sprite-1");
     * ```
     */
    async get(alias: string): Promise<BlobLike | undefined> {
      const record = await safeGet(state, alias);
      return record?.blob;
    },

    /**
     * Enumerate imported assets, sorted by name.
     *
     * @returns The read-only projection of `state.meta` ∪ `state.urls`.
     * @example
     * ```ts
     * for (const asset of api.entries()) console.info(asset.alias);
     * ```
     */
    entries(): readonly StoredAsset[] {
      return [...state.meta.entries()]
        .map(([alias, meta]) => toStoredAsset(state, alias, meta))
        .toSorted((a, b) => a.name.localeCompare(b.name));
    },

    /**
     * Remove an asset: delete the blob from the backend, revoke + drop its `blob:` URL, and emit
     * `asset-store:removed`. Never throws.
     *
     * @param alias - The asset's alias to remove.
     * @returns A Promise that resolves once removal is complete.
     * @example
     * ```ts
     * await api.remove("sprite-1");
     * ```
     */
    async remove(alias: string): Promise<void> {
      await safeDelete(state, alias);

      const url = state.urls.get(alias);
      if (url !== undefined) revokeObjectUrl(url);

      state.urls.delete(alias);
      state.meta.delete(alias);

      ctx.emit("asset-store:removed", { alias });
    }
  };
};

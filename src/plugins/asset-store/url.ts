/**
 * @file asset-store plugin — structural `blob:` URL provider (no DOM lib).
 *
 * Declares the minimal structural `UrlLike` surface (`createObjectURL` / `revokeObjectURL`) the
 * plugin mints/revokes session `blob:` URLs through, and probes it from `globalThis.URL` behind a
 * guard — mirroring how `backend.ts` probes `globalThis.indexedDB`. Shared by `api.ts` (mint on
 * import, revoke on remove) and `lifecycle.ts` (mint on start, revoke on stop) so both read the
 * SAME live global at call time (never cached) — the shared helper a test overrides by installing
 * a mock `UrlLike` on `globalThis.URL`, mirroring how `audio` injects a structural `AudioContext`.
 */
import type { BlobLike } from "./types";

/** Minimal structural view of the `URL` static blob-URL surface (no DOM lib). */
export type UrlLike = {
  /** Mint a session-scoped `blob:` URL for a blob. */
  createObjectURL(blob: BlobLike): string;
  /** Revoke a previously minted `blob:` URL, releasing the backing blob. */
  revokeObjectURL(url: string): void;
};

/** Structural view of `globalThis` exposing the optional blob-URL provider. */
type GlobalWithUrl = {
  /** The `URL` constructor/namespace, absent in some runtimes (SSR / tests). */
  URL?: UrlLike;
};

/**
 * Resolve the structural `UrlLike` provider from `globalThis.URL`, guarding the property access
 * itself (some sandboxed runtimes throw on the read, not just omit it).
 *
 * @returns The `UrlLike` provider, or `undefined` when unavailable.
 * @example
 * ```ts
 * const provider = resolveUrlProvider();
 * const url = provider?.createObjectURL(blob);
 * ```
 */
export const resolveUrlProvider = (): UrlLike | undefined => {
  try {
    return (globalThis as GlobalWithUrl).URL;
  } catch {
    return undefined;
  }
};

/**
 * Mint a session `blob:` URL for `blob`, degrading to `undefined` when no provider is available or
 * minting throws — never throws itself.
 *
 * @param blob - The blob to mint a URL for.
 * @returns The minted `blob:` URL, or `undefined`.
 * @example
 * ```ts
 * const url = mintObjectUrl(blob); // "blob:http://…/…" | undefined
 * ```
 */
export const mintObjectUrl = (blob: BlobLike): string | undefined => {
  const provider = resolveUrlProvider();
  if (!provider) return undefined;

  try {
    return provider.createObjectURL(blob);
  } catch {
    return undefined;
  }
};

/**
 * Revoke a previously minted `blob:` URL, best-effort — a missing provider or a throwing revoke is
 * swallowed (never throws).
 *
 * @param url - The `blob:` URL to revoke.
 * @example
 * ```ts
 * revokeObjectUrl(url);
 * ```
 */
export const revokeObjectUrl = (url: string): void => {
  const provider = resolveUrlProvider();
  if (!provider) return;

  try {
    provider.revokeObjectURL(url);
  } catch {
    // Best-effort — never throw.
  }
};

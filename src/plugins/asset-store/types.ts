/**
 * @file asset-store plugin — type definitions.
 *
 * Public contract (Config/State/Api/Events) + the domain types the backend and consumers build
 * against: AssetBackend (async persistence seam), StoredAsset/StoredRecord/StoredAssetMeta, the
 * structural BlobLike (no DOM lib), and ImportOptions. Names no Pixi type and no DOM-ambient type.
 */

/** Structural, opaque binary blob (no DOM lib) — forwarded, never inspected. */
export type BlobLike = {
  /** MIME type, e.g. "image/png". */
  readonly type: string;
  /** Byte length. */
  readonly size: number;
};

/** asset-store event contract (payloads must match the framework Events type). */
export type Events = {
  /** Emitted when an import completes and the blob is persisted + a URL minted. */
  "asset-store:imported": { alias: string; mime: string; byteLength: number };
  /** Emitted when an asset is removed (blob deleted + URL revoked). */
  "asset-store:removed": { alias: string };
};

/** asset-store plugin configuration. */
export type Config = {
  /** IndexedDB database name. `@default "moku-assets"` */
  dbName: string;
  /** Object-store name within the database. `@default "assets"` */
  storeName: string;
  /** Accepted MIME-type prefixes for import. `@default ["image/"]` */
  accept: readonly string[];
};

/** Options for `import()`. */
export type ImportOptions = {
  /** Explicit alias; omitted → derived from name + a short unique suffix. */
  readonly alias?: string;
  /** Original file name (for the derived alias + display). */
  readonly name?: string;
};

/** Cached per-asset metadata (no blob) used to project `entries()`. */
export type StoredAssetMeta = {
  /** Display name (original file name). */
  readonly name: string;
  /** MIME type. */
  readonly mime: string;
  /** Byte length. */
  readonly byteLength: number;
};

/** One imported asset as the asset-browser / asset-ref picker sees it (read-only projection). */
export type StoredAsset = {
  /** The stable alias — the durable reference (rides in SpriteRenderer.sprite; serialized). */
  readonly alias: string;
  /** Display name. */
  readonly name: string;
  /** MIME type. */
  readonly mime: string;
  /** Byte length. */
  readonly byteLength: number;
  /** The live blob: URL this session (thumbnails + resolver). NEVER serialized. */
  readonly url: string | undefined;
};

/** The persisted record shape stored in IndexedDB (blob included). */
export type StoredRecord = {
  /** Primary key = the stable alias. */
  readonly alias: string;
  /** Display name. */
  readonly name: string;
  /** MIME type. */
  readonly mime: string;
  /** The binary blob. */
  readonly blob: BlobLike;
};

/** Async key/value persistence seam over IndexedDB (keyed by alias). Implementations MUST NOT throw. */
export type AssetBackend = {
  /** Open the backing store. Resolves true on a real persistent backend, false on fallback. */
  open(): Promise<boolean>;
  /** Persist a record. Resolves false on a failed write (quota/blocked); never rejects. */
  put(record: StoredRecord): Promise<boolean>;
  /** Read one record by alias, or undefined if absent. Never rejects. */
  get(alias: string): Promise<StoredRecord | undefined>;
  /** Delete one record by alias. No-op if absent. Never rejects. */
  delete(alias: string): Promise<void>;
  /** List every persisted record (for start-time re-hydration). Never rejects. */
  list(): Promise<readonly StoredRecord[]>;
  /** Close the connection (no-op for the in-memory fallback). */
  close(): void;
  /** True if this backend persists across sessions (false = in-memory fallback). */
  readonly persistent: boolean;
};

/** asset-store plugin state. */
export type State = {
  /** Active persistence backend (default IndexedDB-or-memory at start). */
  backend: AssetBackend;
  /** alias → the live blob: URL minted this session. Read synchronously by url(). */
  readonly urls: Map<string, string>;
  /** alias → cached record metadata for entries() projection. */
  readonly meta: Map<string, StoredAssetMeta>;
  /** Config-derived accept guard list. */
  readonly accept: readonly string[];
  /** True once onStart has opened the backend and re-hydrated urls/meta. */
  ready: boolean;
};

/** asset-store plugin API (exposed as app["asset-store"]). */
export type Api = {
  /** Persist an imported blob under a stable alias, mint a blob: URL, emit asset-store:imported. */
  import(blob: BlobLike, opts?: ImportOptions): Promise<StoredAsset>;
  /** The live blob: URL for an alias this session, or undefined. Synchronous. */
  url(alias: string): string | undefined;
  /** Whether the store holds an asset under this alias (synchronous). */
  has(alias: string): boolean;
  /** Read the persisted blob for an alias (async), or undefined. */
  get(alias: string): Promise<BlobLike | undefined>;
  /** Enumerate imported assets — a read-only projection of state.meta ∪ state.urls, sorted by name. */
  entries(): readonly StoredAsset[];
  /** Remove an asset: delete the blob, revoke + drop its URL, emit asset-store:removed. */
  remove(alias: string): Promise<void>;
};

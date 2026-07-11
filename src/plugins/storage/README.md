# storage

> Standard plugin — namespaced, **versioned** key/value save/persistence with a migration chain, behind a pluggable **`StorageBackend` seam**. **Safe by construction:** every read/write degrades to an in-memory `Map` instead of throwing when `localStorage` is partitioned, blocked, quota-full, or absent. Zero runtime dependencies. Foundational (Wave 1), no game-plugin dependencies.

The `storage` plugin is the game's save layer. Values are JSON-serialized under a `${namespace}:${key}` prefix, so multiple games or features can share one origin's storage without collision. The whole surface is **synchronous** — `get`/`set` need no `await` on the hot path — and **never throws**, which is the plugin's core promise: a storage failure (private mode, a partitioned iframe on CrazyGames/Poki, a full quota, SSR/tests) must never crash the game.

## Safe by construction

The default backend probes `globalThis.localStorage` behind a guard. If the probe round-trip succeeds it wraps `localStorage`; otherwise it falls back to a plain in-memory `Map`. Either way, **no method throws**:

- Reads that fail return the fallback (`get`) or `null`/`[]`.
- Writes that fail (quota, blocked) return `false` (`set`) — on the in-memory fallback a write still succeeds (`true`) and is simply lost when the tab closes.
- `isPersistent()` tells the truth, so a game can surface a "progress won't be saved" note.

```ts
const best = app.storage.get<number>("bestHeight", 0); // 0 on a fresh/blocked store
app.storage.set("bestHeight", 128);

if (!app.storage.isPersistent()) {
  // partitioned iframe / private mode — warn the player
}
```

## The `StorageBackend` seam (IoC, not a `platform` dependency)

Persistence sits behind a synchronous `StorageBackend` interface. `storage` owns the interface and ships the safe localStorage-or-memory default; a later **`platform`** plugin (which depends on `storage`) implements the interface over the CrazyGames data API and injects it:

```ts
// A future platform adapter, at its own onStart:
app.storage.setBackend(crazyGamesBackend); // re-migrates on next read
```

This inversion of control is deliberate. `storage` never imports `platform`, so it stays foundational (Wave 1) with no cross-plugin edges — while `platform` still gets to route saves through the portal's own data API. Its `getItem` contract returns `string | null` to mirror the Web Storage API exactly, so a localStorage-shaped backend is drop-in.

## Versioned schema & lazy migration

The save schema is versioned. A stored snapshot at an older `version` is upgraded through a **migration chain** — `migrations[n]` transforms a whole-namespace snapshot from `v(n-1)` to `vn`. The chain runs **lazily on first access**, once (memoized):

```ts
const app = createApp({
  pluginConfigs: {
    storage: {
      namespace: "save",
      version: 2,
      migrations: {
        // v1 → v2: rename `hp` to `health`
        2: (snapshot) => {
          const { hp, ...rest } = snapshot;
          return { ...rest, health: hp };
        }
      }
    }
  }
});
```

Lazy — not at a lifecycle hook — is **load-bearing**: it guarantees the chain runs against whichever backend is active at first read, including one the `platform` plugin injects *after* `storage` starts. `setBackend()` resets the memoization so an injected backend is migrated on its next access. A store already at `version` is untouched; a fresh store is stamped with no migration; a store **newer** than the app is left intact with a warning (no downgrade).

## API

Accessed as `app.storage.*` after `createApp()`. Every method is non-throwing.

### `get<T>(key, fallback?): T | undefined`

Read + JSON-parse a value. Returns `fallback` (or `undefined`) when the key is absent, unparseable, or storage is unavailable. Triggers the lazy migration on first call.

### `set(key, value): boolean`

JSON-serialize and write a value. Returns `true` on success, `false` when the backend rejected the write (quota / blocked) or the value is not JSON-serializable. Never throws.

### `has(key): boolean`

Whether the namespaced key exists.

### `remove(key): void`

Remove a single key. No-op if absent.

### `clear(): void`

Remove **every** key in this namespace, then re-write the reserved version-stamp so the schema version is preserved.

### `keys(): string[]`

List all keys in this namespace with the `${namespace}:` prefix stripped (the reserved meta key excluded). Returns `[]` on failure.

### `isPersistent(): boolean`

`true` when a real persistent backend is active; `false` on the in-memory fallback or an injected non-persistent backend.

### `getVersion(): number`

The schema version currently in effect (after any lazy migration).

### `setBackend(backend): void`

Inject a custom `StorageBackend` (the `platform` plugin's CrazyGames adapter). Resets migration so the new backend is migrated on the next access. All backend methods MUST be synchronous and non-throwing.

## Configuration

Per-plugin config under `pluginConfigs.storage`.

| Field | Type | Default | Description |
|---|---|---|---|
| `namespace` | `string` | `"game"` | Key prefix — every entry is stored as `${namespace}:${key}`. |
| `version` | `number` | `1` | Current save-schema version; a lower stored snapshot is migrated up to it. |
| `migrations` | `Record<number, Migration>` | `{}` | `migrations[n]` upgrades a `v(n-1)` namespace snapshot to `vn`. |

## Types

- **`StorageBackend`** — the synchronous persistence seam (`getItem` / `setItem` / `removeItem` / `keys` + a `persistent` flag). Implementations must never throw.
- **`Migration`** — `(snapshot: Snapshot) => Snapshot`; upgrades a whole-namespace snapshot one version.
- **`Snapshot`** — `Record<string, unknown>`; un-prefixed key → parsed value, the shape a migration receives.

## Events

None. `storage` is a pure persistence primitive that game and `platform` code **call**; it has nothing coarse-grained to broadcast, and emitting on every `set()` would be hot-path noise. Persisting another plugin's state (e.g. `audio`'s mute/volume) is the caller's job: whoever hooks `audio:muteChanged` / `audio:volumeChanged` then calls `app.storage.set(...)`.

## Lifecycle

None. `storage` manages **no resource** — `localStorage` is a stateless global with nothing to open, and the in-memory fallback is a plain `Map` created in `createState`. There is no `onStart` / `onStop`. Migration runs lazily on first access precisely so it targets the backend the `platform` plugin injects *after* `storage` starts (an eager `onStart` migration would migrate the wrong, default backend).

## Design Notes

- **No DOM lib:** the framework tsconfig omits the DOM `lib`, so `localStorage` is declared structurally as a minimal `WebStorageLike` interface in `backend.ts` (mirroring how `audio` declares structural WebAudio types) — keeping the shipped `.d.ts` free of ambient DOM dependencies.
- **Synchronous seam:** `localStorage` and the in-memory fallback are synchronous, matching how a game loop reads/writes save state. CrazyGames' async data API is bridged **inside** the future `platform` backend (a sync-facing facade that flushes to the async API in the background) — that is `platform`'s concern, deferred here.
- **Backend lives on State:** with no lifecycle, the active backend sits directly on `State` (unlike `audio`, which parks its live `AudioContext` in a `ctx.global` WeakMap because it has `onStart`/`onStop`).
- **Defence in depth:** the default backend already wraps `localStorage`, but `setBackend()` accepts arbitrary implementations, so the API additionally guards every backend call — no method throws even against a misbehaving injected backend.

## Dependencies

- **None** (game plugins). Storage is foundational (Wave 1) and depends only on the always-present core `log` / `env` (Layer 1). It uses `ctx.log` for the degraded-mode notice and touches neither the network nor Pixi.
- **No package dependency** — `localStorage` and `JSON` are browser/language globals (no `idb`/`localforage`/polyfill), preserving the issue-#5 load-budget goal.

**Deferred cross-plugin wiring (not a dependency):** the future `platform` plugin will `depends: [storagePlugin]` and call `app.storage.setBackend(crazyGamesBackend)` at its `onStart`; game/`platform` code will persist `audio` mute/volume via `app.storage.set(...)`. Storage imports and requires none of them.

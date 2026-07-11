# platform

> Complex plugin — the **portal-SDK adapter layer** that ships one game codebase as a monetizable build for **CrazyGames, Poki, and Newgrounds** (plus a **no-op / standalone** adapter for local dev and self-hosting). One internal `PortalAdapter` interface, one implementation per portal, the **active adapter selected per build via `ctx.env`**. Depends on `audio`, `loop`, and `storage`. No new package dependency — portal SDKs are runtime-injected from the portal CDN.

The `platform` plugin is the seam between your game and the portal it ships to. The public surface (`app.platform.*`) is **portal-agnostic**: the same game code calls `commercialBreak()` / `rewardedAd()` / `gameplayStart()` and produces a distinct per-portal bundle depending only on which portal `ctx.env` resolves. It coordinates the three cross-plugin concerns every portal requires:

1. **Lifecycle signals** — `gameplayStart()`/`gameplayStop()`, `loadingStart()`/`loadingFinished()`.
2. **Ads** — promise-based `commercialBreak()` (interstitial) and `rewardedAd()` that **auto-pause `loop` and mute `audio`** on call and restore on settle, honouring a per-portal **interstitial frequency cap**.
3. **Save routing** — injects a portal-native `StorageBackend` into `storage` via `setBackend()` (CrazyGames data API when available; Poki/Newgrounds keep storage's safe `localStorage` default).

It also persists the `audio` mute/volume preferences through `storage` and rehydrates them at start — closing the persistence both the `audio` and `storage` specs deferred to "a future storage/platform plugin".

## Env-selected adapter (one interface, one bundle per portal)

`config.portal` defaults to `"auto"`, which resolves the active portal from `ctx.env.get(config.portalEnvVar)` (default `GAME_PORTAL`) at `onStart`. An explicit `config.portal` overrides the env lookup (used by tests and consumers that wire the portal themselves). An unknown/absent value — or a headless runtime with no `window` — resolves to the **`none`** no-op adapter, which is safe for local dev.

```sh
# Build each portal's bundle from the same game code:
GAME_PORTAL=crazygames bun run build
GAME_PORTAL=poki       bun run build
```

Portal SDKs are **not** npm dependencies. Each adapter loads its portal's runtime SDK (`window.CrazyGames`, `window.PokiSDK`, `window.Newgrounds`) — expected on the page, best-effort `<script>`-injected otherwise — and types the SDK **structurally**, so no portal package enters `package.json` and the shipped `.d.ts` carries no SDK-ambient types. A degraded (SDK-unavailable) adapter no-ops its ads rather than throwing.

## Ads are capture-then-restore

`commercialBreak()` / `rewardedAd()` leave the game exactly as they found it. Each ad **captures** `loop.isRunning()` and `audio.isMuted()` **before** the ad, then pauses (`loop.stop()`) + mutes (`audio.mute()`), and on settle (resolve **or** reject) **restores only what it changed** — `loop.start()` only if the loop was running before, `audio.unmute()` only if audio was not already muted before. So an ad shown from a paused menu is not wrongly un-paused, and an ad in an already-muted session is not wrongly un-muted.

- **Frequency cap** — a `commercialBreak()` inside the `minInterstitialSeconds` window resolves immediately as a no-show (no adapter call).
- **Re-entrancy guard** — a second ad call while one is in flight is a no-op (`commercialBreak` resolves; `rewardedAd` resolves `false`).
- **Never rejects** — a rejecting adapter ad still restores `loop` + `audio` and resolves to the caller (interstitial → resolves; rewarded → `false`).

```ts
// Between runs — a frequency-capped interstitial:
app.platform.gameplayStop();
await app.platform.commercialBreak();
app.platform.gameplayStart();

// A rewarded ad — loop paused + audio muted during, restored after:
if (await app.platform.rewardedAd()) grantExtraLife();
```

The same capture-then-restore drives the `window` **focus/blur + visibilitychange** listeners: the game pauses + mutes on focus loss and restores on focus regain (portals require the game paused when hidden). Iframe-safe — only the game's own `window` is read, never `window.top`.

## API

Accessed as `app.platform.*` after `createApp()`.

### `getPortal(): Portal`

The portal resolved at start (`"crazygames"` | `"poki"` | `"newgrounds"` | `"none"`).

### `gameplayStart()` / `gameplayStop()`

Signal that active gameplay started / stopped. Some portals gate ad timing and analytics on these.

### `loadingStart()` / `loadingFinished()`

Signal the loading phase. Usually driven by `onStart`; exposed for manual control.

### `commercialBreak(): Promise<void>`

Show an interstitial ad. Pauses `loop` + mutes `audio` (when `pauseOnAd`) and restores both on settle. Honours the frequency cap; a call inside the window resolves immediately. Never rejects.

### `rewardedAd(): Promise<boolean>`

Show a rewarded ad. Same coordination as `commercialBreak`. Resolves `true` when watched to completion (grant the reward), else `false`. The `none` adapter resolves `true`, so local dev exercises the reward-granted branch.

### `isAdPlaying(): boolean`

`true` while an ad is currently in flight.

## Configuration

Per-plugin config under `pluginConfigs.platform`.

| Field | Type | Default | Description |
|---|---|---|---|
| `portal` | `Portal \| "auto"` | `"auto"` | The active portal, or `"auto"` to resolve from `ctx.env`. |
| `portalEnvVar` | `string` | `"GAME_PORTAL"` | Env var read (case-insensitive) to resolve the portal when `"auto"`. |
| `pauseOnAd` | `boolean` | `true` | Pause `loop` + mute `audio` for the duration of every ad (and on focus loss). |
| `minInterstitialSeconds` | `number` | `60` | Minimum seconds between interstitial shows (frequency cap). |
| `useNativeStorage` | `boolean` | `true` | Route saves through the adapter's native `StorageBackend` when it provides one. |
| `persistAudioPrefs` | `boolean` | `true` | Persist + rehydrate `audio` mute/volume through `storage`. |

## Events

| Event | Payload | When |
|---|---|---|
| `platform:ready` | `{ portal }` | The active adapter is initialised and loading is signalled finished. |
| `platform:adStart` | `{ type }` | An ad begins (after pause + mute). |
| `platform:adEnd` | `{ type, rewarded? }` | An ad ends (after resume + unmute). `rewarded` is set for rewarded ads. |

A HUD can hook `platform:adStart` / `platform:adEnd` to show/hide an "ad playing" overlay.

## Audio-preference persistence

When `persistAudioPrefs` is on (default), `platform` hooks two `audio` events and mirrors them into `storage`:

- `audio:muteChanged` → `storage.set("audio.muted", muted)`
- `audio:volumeChanged` → `storage.set("audio.volume." + channel, value)`

At `onStart` (after any native-backend injection, so prefs read from the portal store), `platform` reads those keys back and applies them to `audio` via `setMuted` / `setVolume`. A fresh store leaves `audio` at its configured defaults.

## The CrazyGames async→sync storage bridge

`storage`'s `StorageBackend` is **synchronous and non-throwing**, but the CrazyGames data API is async. The CrazyGames adapter satisfies the contract with a write-through in-memory snapshot: `init()` awaits an async hydrate **before** `storage.setBackend()` runs, `getItem`/`keys` read the snapshot, `setItem`/`removeItem` mutate it synchronously (returning `true`) and flush to the portal best-effort. Because `storage` migrates lazily on first access and `setBackend()` resets its `migrated` flag, migration correctly targets the hydrated snapshot. Poki and Newgrounds expose no game-save API, so their adapters provide **no** backend — `storage` keeps its localStorage default.

## Lifecycle

`onStart` / `onStop` are justified: the loaded SDK + DOM focus/visibility listeners are a real, long-lived resource. `onStart` resolves the portal, builds + `init()`s the adapter, injects the native backend, rehydrates audio prefs, registers listeners, records the runtime, and emits `platform:ready`. `onStop` removes the listeners, calls `adapter.destroy()`, and clears the runtime so a re-`start()` builds fresh. The live adapter + listeners live in a `ctx.global` WeakMap (the `audio` / `loop` pattern); `State` holds only the serializable session mirror (resolved portal, ad-flight flag, last-interstitial timestamp).

## Design Notes

- **Adapters are providers** — one `PortalAdapter` interface, four implementations in `adapters/`. Adding a portal is one entry in `adapters/index.ts` + one adapter file; the public API is unchanged. Rejected: a single `switch (portal)` `api.ts` (fuses four SDK integrations, defeats per-adapter unit testing).
- **No DOM/SDK lib** — the framework tsconfig omits the DOM `lib`, so each adapter declares its SDK + the minimal `window` surface **structurally** (mirroring `audio`'s WebAudio and `storage`'s `WebStorageLike` types) — the shipped `.d.ts` stays ambient-free.
- **Headless-safe** — with no `window`, the resolver falls back to `none` and every effectful path no-ops (SSR / tests never throw).

## Dependencies

- **`audio`** — `isMuted()` / `mute()` / `unmute()` during ads + focus loss; `setMuted()` / `setVolume()` to rehydrate prefs.
- **`loop`** — `isRunning()` / `stop()` / `start()` to capture-then-restore-pause during ads + focus loss.
- **`storage`** — `setBackend()` to inject the portal-native backend; `get()` / `set()` to persist + rehydrate audio prefs.
- **Core `ctx.env` / `ctx.log`** (Layer 1) — `ctx.env.get(portalEnvVar)` resolves the active portal; `ctx.log` carries the SDK-load / degraded-mode notices. No raw `process.env` / `console.*`.
- **No package dependency** — portal SDKs are runtime-injected and typed structurally, preserving the issue-#5 load-budget goal.

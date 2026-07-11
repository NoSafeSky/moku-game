# audio

> Standard plugin — native **WebAudio** SFX + music with a master **mute bus**, per-channel + master volume, and a user-gesture `unlock()` (no autoplay). Zero runtime dependencies. Foundational (Wave 1), no game-plugin dependencies.

The `audio` plugin owns a small gain graph it manages directly — no [Howler.js](https://howlerjs.com/), no `pixi.js`. WebAudio (`AudioContext`, `GainNode`, `AudioBufferSourceNode`) is a browser global typed by the DOM lib, so pooled one-shot SFX, looping music with fades, per-channel volume, a global mute, and a user-gesture unlock are all a handful of `GainNode`s away — keeping the load budget light (the CrazyGames/Poki `<10s load / <20MB build` target that drove this plugin).

The single most important node is **`masterGain` — the mute bus**. Muting the whole mix (during an ad break, on focus loss) is one call — `app.audio.mute()` — that zeroes that one node. A future `platform` adapter invokes exactly that.

## Gain graph

On start the plugin builds this graph (held per app in a `ctx.global` `WeakMap`, the same pattern the `loop` plugin uses for its rAF handle):

```
one-shot / music source → channelGain(sfx | music) → masterGain → destination
```

- **`masterGain`** — the mute bus. `mute()` sets it to `0`; `unmute()` restores it to the stored master volume. Its unmuted value is `masterVolume`.
- **`sfxGain`** — the sfx channel; `play()` one-shots route here (optionally through a transient per-shot gain for a per-shot volume override).
- **`musicGain`** — the music channel; `playMusic()` connects the looping track here and ramps this node for fades.

The live graph, the `AudioContext`, and the active music source live in a module-level `WeakMap<object, AudioEngine>` keyed on the frozen per-instance `ctx.global` — created in `onStart`, torn down in `onStop` (whose `TeardownContext` exposes only `{ global }`). The plugin **state** holds only the session-serializable mirror: mute flag, per-channel volumes, the decoded-buffer cache, and the unlock flag.

## No autoplay — `unlock()` gates playback

Browsers start an `AudioContext` **suspended** and refuse to play audio until a user gesture resumes it. The plugin honours this: `state.unlocked` starts `false`, and `play()` / `playMusic()` **no-op** until you call `app.audio.unlock()` from within a real user gesture (a title-screen tap or keypress). `unlock()` is idempotent — safe to call on every gesture.

```ts
// On the first user interaction:
await app.audio.unlock();
await app.audio.load("jump", "sfx/jump.webm");
app.audio.play("jump");
```

## API

Accessed as `app.audio.*` after `createApp()`.

### `unlock(): Promise<void>`

Resumes the `AudioContext` after a user gesture, then sets `state.unlocked`. Idempotent; a no-op when headless.

### `load(name, url?): Promise<void>`

`fetch` + `decodeAudioData` a sound and cache the buffer under `name`. `url` falls back to `config.manifest[name]`. A cached name is a no-op — **one decode per name** ("pooling" one-shots = buffer reuse). No-op when headless, or when no url resolves.

```ts
await app.audio.load("jump", "sfx/jump.webm"); // explicit url
await app.audio.load("theme");                 // url from the manifest
```

### `play(name, opts?): void`

Play a one-shot SFX by name on the sfx channel. Returns immediately. No-op (debug log) if headless, not unlocked, or not loaded.

- `opts.volume` — per-shot volume `0..1` (clamped), routed through a transient per-shot gain.
- `opts.rate` — playback rate (`1` = normal); scales pitch + speed.

```ts
app.audio.play("jump", { volume: 0.8, rate: 1.2 });
```

### `playMusic(name, opts?): void`

Play looping music by name on the music channel, **stopping any current track first** (one music track at a time). No-op (debug log) if headless, not unlocked, or not loaded.

- `opts.loop` — whether the track loops. Default `true`.
- `opts.fadeIn` — seconds to ramp the music gain from `0`. Default `0` (start at full volume).

```ts
app.audio.playMusic("theme", { fadeIn: 0.5 });
```

### `stopMusic(opts?): void`

Stop the current music track. `opts.fadeOut` seconds ramps the music gain to `0` before stopping (default `0` = immediate). No-op when headless or nothing is playing.

```ts
app.audio.stopMusic({ fadeOut: 1 });
```

### `mute() / unmute() / setMuted(muted) / isMuted()`

The **mute bus** controls. `mute()` zeroes `masterGain`; `unmute()` restores it to the stored master volume; `setMuted(x)` sets it explicitly. All three emit `audio:muteChanged` **only on an actual change**. `isMuted()` is a pure read.

```ts
app.audio.mute();   // one call ducks the whole mix (ad break)
// …ad plays…
app.audio.unmute(); // restore
```

### `setVolume(channel, value) / getVolume(channel)`

Set/get a channel volume `0..1` (clamped). `channel` is `"master" | "sfx" | "music"`. `setVolume` writes the matching gain node and emits `audio:volumeChanged` **on change**. Setting `"master"` **while muted** updates the stored value but keeps the bus at `0` — the new value takes effect on the next `unmute()`.

```ts
app.audio.setVolume("music", 0.5);
const musicVolume = app.audio.getVolume("music"); // → 0.5
```

## Mute bus & rehydration

`mute` / `volume` state is the one thing worth persisting across sessions. The plugin emits the coarse `audio:muteChanged` / `audio:volumeChanged` milestone events for a future `storage` / `platform` plugin to persist, and reads the persisted values back through config on the next boot:

- **Emit** — `mute()` / `setVolume()` fire the events on change; a listener persists them.
- **Rehydrate** — `config.muted` and the volume fields double as rehydration inputs. A `platform` / `storage` plugin passes the persisted session values via `pluginConfigs.audio.*`, so `createState` seeds the mirror and `onStart` builds the graph at the restored levels. Audio needs **no** direct dependency on storage.

## Configuration

Per-plugin config under `pluginConfigs.audio`. Volumes are `0..1` and clamped on apply.

| Field | Type | Default | Description |
|---|---|---|---|
| `masterVolume` | `number` | `1` | Master volume `0..1` (the mute-bus gain when unmuted). |
| `sfxVolume` | `number` | `1` | SFX channel volume `0..1`. |
| `musicVolume` | `number` | `1` | Music channel volume `0..1`. |
| `muted` | `boolean` | `false` | Start muted (e.g. rehydrated from a prior session). |
| `manifest` | `Record<string, string>` | `{}` | Preload manifest of `name → url`, decoded lazily on first `load`/use. |

## Events

Coarse, discrete, non-hot-path milestones (mute/volume are user- or platform-driven and rare) — the one place kernel events are appropriate, matching the `assets:loaded` rationale.

| Event | Payload | When |
|---|---|---|
| `audio:muteChanged` | `{ muted: boolean }` | Global mute state changes. |
| `audio:volumeChanged` | `{ channel: Channel; value: number }` | A channel volume changes. |

`play` / `playMusic` / `stopMusic` are hot-path and emit **nothing**.

## Lifecycle

The `AudioContext` is a real, long-lived browser resource, so the plugin uses `onStart` / `onStop`:

- **`onStart`** — builds the `AudioContext` + master/sfx/music gain graph from config, applies the initial volumes (master at `0` when `muted`), and stores the `AudioEngine` in the module `WeakMap` keyed on `ctx.global`. When no `AudioContext` exists it records a **headless engine** and logs an info line.
- **`onStop`** — reads the engine from the `WeakMap` via `ctx.global`, stops the active music source, calls `AudioContext.close()`, and deletes the `WeakMap` entry so a re-`start()` builds a fresh graph. Idempotent.

## Headless

Mirroring the renderer's headless guard, every API method **no-ops without throwing** when no `AudioContext` is available (SSR / tests): `onStart` records a headless engine, the effectful methods return early (playback ones log a debug line), and the getters (`isMuted`, `getVolume`) still return the state mirror. Nothing autoplays and nothing throws in a non-browser runtime.

## Usage Example

```ts
import { createApp } from "./index";

const app = createApp({
  pluginConfigs: {
    audio: {
      masterVolume: 1,
      musicVolume: 0.6,
      manifest: { jump: "sfx/jump.webm", theme: "music/theme.webm" }
    }
  }
});

await app.start();

// On the first user gesture:
await app.audio.unlock();

await app.audio.load("jump");   // url from the manifest
app.audio.play("jump");
app.audio.playMusic("theme", { fadeIn: 0.5 });

// A platform adapter, on an ad break:
app.audio.mute();               // one call ducks the whole mix
// …ad plays…
app.audio.unmute();
```

## Design Notes

- **WebAudio, not Howler:** a zero-dependency browser global gives us pooled one-shots, gain routing, looping music, and fades directly. Howler adds ~30 KB and a second abstraction for capabilities a handful of `GainNode`s already provide — and its broad cross-browser fallbacks target a wider matrix than the modern iframe-embedded portals this framework ships to.
- **The master node is the mute bus:** owning the gain graph directly is what makes "duck the entire mix" a single `GainNode` write. A platform adapter's ad-break handler calls `mute()` / `unmute()` and nothing else.
- **Session mirror vs. live graph:** `State` holds only serializable data (mute, volumes, decoded buffers, unlock flag); the `AudioContext` + gain nodes + active source live in a `ctx.global` `WeakMap`. This keeps `State` rehydratable and gives `onStop` a stable per-instance key it can reach from a `{ global }`-only `TeardownContext`.
- **No autoplay:** `unlock()` gates `play` / `playMusic`, so no source is audible before the first user gesture — the browser autoplay policy is honoured by construction.
- **Structural WebAudio types:** the DOM `lib` is intentionally absent from this project's tsconfig, so the WebAudio surface is declared as minimal structural interfaces (`AudioContextLike`, `GainNodeLike`, …). This keeps the shipped `.d.ts` free of ambient DOM dependencies and follows the framework's "own your injectable types" rule.
- **Graceful headless degradation:** `AudioContext` (and its `webkit`-prefixed fallback) and `fetch` are read structurally off `globalThis` as optional. In a non-browser runtime they are simply absent, so the engine is headless and every method no-ops.
- **Decode stays in audio:** the plugin loads and decodes its own audio via `fetch` + `AudioContext.decodeAudioData` because Pixi v8 `Assets` (the `assets` plugin) targets textures/spritesheets, not audio — keeping `audio` dependency-free.

## Dependencies

- **None** (game plugins). Audio is foundational (Wave 1) and depends only on the always-present core `log` / `env` (Layer 1).
- **No package dependency** — WebAudio globals only (no `howler`, no `pixi.js`), preserving the load-budget goal.

**Deferred cross-plugin wiring (not a dependency):** a future `platform` plugin will call `audio.mute()` / `unmute()` during ad breaks and on focus loss; a future `storage` / `platform` plugin will hook `audio:muteChanged` / `audio:volumeChanged` to persist and rehydrate via `pluginConfigs.audio.*`. Audio neither imports nor requires them.

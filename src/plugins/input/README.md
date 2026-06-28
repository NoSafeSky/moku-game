# input

> Standard plugin — polled keyboard/pointer input captured from DOM listeners and exposed as a stable per-frame snapshot.

The `input` plugin maintains a single mutable input resource (held keys, per-frame edge sets, and pointer position/buttons) that DOM event listeners mutate as events arrive. Once per frame, an `"input"`-stage ECS system freezes that live state into an immutable `InputSnapshot` and clears the edge sets, so every system that runs later in the same tick reads a consistent, frame-aligned view of the input.

This is a **polled** model, not an event-driven one: nothing about input flows through the kernel event bus. Systems do not subscribe to keystrokes — they call `app.input.snapshot()` (or receive the snapshot) and query it. Polling keeps gameplay deterministic and frame-aligned: `justPressed` / `justReleased` are true for exactly one frame regardless of how many raw DOM events fired.

## API

Accessed as `app.input.*` after `createApp()`:

### `snapshot(): InputSnapshot`

Returns the current frame's immutable `InputSnapshot`. The returned object is stable for the whole tick — the `"input"`-stage system replaces `state.snapshot` with a fresh object once per frame, so capturing it at the top of a system and reading it repeatedly is safe.

```ts
const snap = app.input.snapshot();
if (snap.isDown("ArrowRight")) move(dt);
```

Before the first tick runs, `snapshot()` returns an initial snapshot backed by the empty live sets, so reads are safe even prior to the first frame.

### `InputSnapshot`

The snapshot is the actual query surface. It exposes three keyboard predicates plus a frozen pointer.

| Member | Signature | Description |
|---|---|---|
| `isDown` | `(key: string) => boolean` | True while the key is held (key matches `KeyboardEvent.key`, e.g. `"ArrowRight"`, `"Space"`, `"a"`). |
| `justPressed` | `(key: string) => boolean` | True only on the frame the key first transitioned to down. Key-repeat is ignored. |
| `justReleased` | `(key: string) => boolean` | True only on the frame the key transitioned to up. |
| `pointer` | `{ readonly x: number; readonly y: number; readonly buttons: number }` | Pointer position (from `clientX`/`clientY`) and the pressed-button bitmask, as of the moment the snapshot was taken. |

```ts
const snap = app.input.snapshot();

if (snap.justPressed("Space")) player.jump();        // one frame only
if (snap.isDown("ShiftLeft")) player.sprint(dt);     // every held frame
const { x, y, buttons } = snap.pointer;              // buttons bitmask: 1 = left, 2 = right, 4 = middle
```

### Injection — `keyDown` / `keyUp` / `keyPress`

Programmatic input, so an agent or test can **play** the game without real DOM events. Each method mutates the same live edge-sets the DOM listeners do, so the next `"input"`-stage snapshot observes it exactly like a genuine key event. Used by the `mcp` plugin's `input:key` tool.

Each method first **normalizes** its key argument (see [Key aliases](#key-aliases)) before touching the edge-sets, so injected keys agree with the canonical `KeyboardEvent.key` values the DOM handler stores.

| Method | Signature | Description |
|---|---|---|
| `keyDown` | `(key: string) => void` | Hold a key down (and flag `justPressed` if it was not already down) — mirrors a DOM `keydown`. Normalizes the key first. |
| `keyUp` | `(key: string) => void` | Release a held key and flag `justReleased` — mirrors a DOM `keyup`. Normalizes the key first. |
| `keyPress` | `(key: string) => void` | One-frame tap: flags `justPressed` **and** `justReleased` for the next snapshot without ever holding the key (ideal for discrete actions like jump/fire/confirm). Normalizes the key first. |

```ts
app.input.keyDown("ArrowRight"); // start holding right
app.loop.step();                 // the next snapshot reports isDown("ArrowRight") === true
app.input.keyUp("ArrowRight");   // stop holding
app.input.keyPress("Space");     // a single tap — equivalent to keyPress(" ")
```

Injection is applied **directly** (not through the ECS command buffer): the input edge-sets are designed to be written between frames, and the single reader (the input-stage system) snapshots them on the next tick. This matches real DOM-event semantics and keeps edge timing correct.

#### Key aliases

The three injection methods normalize a small set of friendly key names to their canonical `KeyboardEvent.key` values before mutating the edge-sets. All other keys (arrow keys, letters, digits) already equal their `.key` and pass through unchanged.

| Alias | Canonical `KeyboardEvent.key` |
|---|---|
| `"Space"` | `" "` (a single space — the real `.key` for the spacebar) |
| `"Spacebar"` | `" "` |
| `"Esc"` | `"Escape"` |

So `app.input.keyDown("Space")` is equivalent to `keyDown(" ")`, and `keyPress("Esc")` is equivalent to `keyPress("Escape")`. The snapshot taken after injection therefore observes the **canonical** key, not the alias: after `keyDown("Space")` the next snapshot reports `isDown(" ") === true` (not `isDown("Space")`). Match the same canonical strings the DOM handler uses when querying the snapshot.

> The normalization helper (`normalizeKey`) is exported for unit testing only and is **not** part of the public `Api`.

## Lifecycle

The plugin owns real DOM listener resources, so both lifecycle hooks are used (both marked `@no-resource-check` — the managed resource is the listener set, not a handle returned from a factory).

- **`onStart`** — resolves `config.target` to a live `EventTarget`, attaches `keydown`/`keyup` (when `keyboard`) and `pointermove`/`pointerdown`/`pointerup` (when `pointer`), records each `{ type, fn, target }` in `state.listeners`, stashes that list in a module `WeakMap` keyed on the frozen `ctx.global`, then registers the snapshot-rolling system via `ctx.require(schedulerPlugin).addSystem("input", system)`.
- **`onStop`** — looks the listener list up by `ctx.global`, calls `removeEventListener` for every entry, empties the array, and deletes the `WeakMap` entry. This guards against leaked global listeners across app restarts and makes `stop()` idempotent.

Target resolution is node-safe: `"window"` resolves to `globalThis.window` (falling back to `globalThis`), and any other string is treated as a selector resolved via `document.querySelector`. When no DOM is present, it falls back to `globalThis`, so the plugin loads without crashing in a headless runtime.

## Configuration

| Field | Type | Default | Description |
|---|---|---|---|
| `target` | `string` | `"window"` | DOM target to attach listeners to. `"window"` uses the global window; any other string is a CSS selector resolved via `document.querySelector` at start. |
| `pointer` | `boolean` | `true` | When `true`, attach `pointermove`/`pointerdown`/`pointerup` listeners and track pointer position + buttons. |
| `keyboard` | `boolean` | `true` | When `true`, attach `keydown`/`keyup` listeners and track key state. |
| `preventDefault` | `boolean` | `false` | When `true`, call `event.preventDefault()` on every tracked key event (e.g. to stop arrow/space scrolling). |

## Events

None. Input is polled, not event-driven — the plugin emits no kernel events and listens for none. Raw browser events are consumed by the plugin's own DOM listeners and never re-emitted onto the framework event bus. Read input by querying the per-frame snapshot instead.

## Usage Example

```ts
import { createApp } from "./index";

const app = createApp({
  pluginConfigs: {
    input: {
      target: "window",
      keyboard: true,
      pointer: true,
      preventDefault: true // stop arrows/space from scrolling the page
    }
  }
});

await app.start(); // attaches DOM listeners + registers the "input"-stage system

// Poll input inside a gameplay system. The "input" stage runs first each frame,
// so the snapshot read here already reflects this frame's edge transitions.
app.scheduler.addSystem("update", (world, dt) => {
  const input = app.input.snapshot();

  if (input.isDown("ArrowLeft")) player.x -= player.speed * dt;
  if (input.isDown("ArrowRight")) player.x += player.speed * dt;
  if (input.justPressed("Space")) player.jump();
  if (input.justReleased("Space")) player.endChargedJump();

  const { x, y, buttons } = input.pointer;
  if (buttons & 1) player.aimAt(x, y); // left button held
});

// ... later
await app.stop(); // removes every tracked DOM listener
```

## Design Notes

- **Polled, not event-driven.** DOM listeners mutate a live resource (`state.down` / `pressed` / `released` / `pointer`); the `"input"`-stage system snapshots and clears it once per frame. No keystroke ever touches the kernel event bus.
- **Edge-state buffering.** `keydown` adds to `pressed` only when the key was not already in `down` (key-repeat is filtered); `keyup` removes from `down` and adds to `released`. The system copies these into the snapshot and then clears `pressed`/`released`, so `justPressed`/`justReleased` are true for exactly one frame.
- **Snapshot stability.** Each tick the system builds a brand-new `InputSnapshot` over fresh `Set` / pointer copies and assigns it to `state.snapshot`. The snapshot closes over its own copies, so it never changes mid-frame even as listeners keep mutating the live state for the next frame.
- **Stage placement.** The system registers in the scheduler's first stage, `"input"` (order: `input → update → physics → sync → render`). Rolling the snapshot at the very start of the frame means every later stage sees this frame's input.
- **WeakMap teardown.** The kernel freezes `ctx.global`, and `onStop` only receives `{ global }`. The plugin stashes the listener list in a module-level `WeakMap<object, …>` keyed on `ctx.global` so teardown can find and detach the exact listeners without mutating the frozen object — the same pattern used by the `loop` and `mcp` plugins.
- **Structural context.** The plugin uses a structural `InputContext` type that declares only `global`, `config`, `state`, and a narrowed `require` (just `addSystem("input", …)`), letting unit tests supply a minimal mock without wiring the full kernel.
- **DOM-lib-free types.** The tsconfig targets ESNext with no DOM lib, so handler factories accept minimal structural `KeyboardEventLike` / `PointerEventLike` shapes rather than `lib.dom` types.

## Dependencies

- **`scheduler`** (`ctx.require(schedulerPlugin)`) — the input plugin registers its snapshot-rolling system via `addSystem("input", …)` so the per-frame update runs in the world's first scheduler stage. There is no direct `ecs` dependency: `scheduler` already depends on `ecs`, so the input-stage system runs inside the world through `scheduler`; declaring `ecs` here would be a dead `depends` edge.
- No package dependencies beyond `@moku-labs/core` (DOM types are structural, declared locally).

# ui

> Complex plugin — the **game-UI layer**: a **screen stack** (title / pause / game-over / modal cards), a small **declarative widget set** (`label` / `button` / `panel` / `bar`), a **persistent HUD**, and **pointer/touch hit-testing** — all rendered **natively into the renderer's Pixi stage**. Emits **no** events (interactions are declarative `onTap` callbacks). **Headless-safe**. Depends on `renderer`, `scheduler`, and `input`. **No new package dependency** (Pixi comes in via `renderer`).

The `ui` plugin draws menus, HUDs, and modal cards **inside the same Pixi canvas** the game already renders to. Widgets are described as **plain data** (no Pixi types leak into the specs); `ui` builds the Pixi objects once and hands back **opaque handles** for later mutation — a retained-mode design, not a per-frame rebuild. A single-canvas UI adds **zero new dependency**, keeps the whole game in one portable surface (ideal for the iframe/portal builds), and shares one coordinate space with the renderer's shake/camera.

**Touch is first-class for free:** the `input` plugin's `pointer` is fed by DOM **pointer events**, which already unify mouse + touch, so button hit-testing works identically on both.

```ts
// Title screen (centered), with a Play button that starts the game:
app.ui.pushScreen({
  widgets: [
    { kind: "label", text: "ASCEND", x: 400, y: 200, fontSize: 48 },
    { kind: "button", text: "Play", x: 400, y: 320, width: 200, height: 56,
      onTap: () => { app.ui.popScreen(); app.loop.start(); } }
  ]
});

// HUD during gameplay:
const score = app.ui.addHud({ kind: "label", text: "0", x: 16, y: 16, anchor: { x: 0, y: 0 } });
const hp = app.ui.addHud({ kind: "bar", value: 100, max: 100, x: 16, y: 44, width: 160, height: 12 });
app.scheduler.addSystem("update", () => {
  app.ui.setText(score, String(currentScore));
  app.ui.setValue(hp, player.health);
});
```

## PixiJS-native, not DOM islands

Rendered natively into the Pixi stage the `renderer` already owns — **not** as an absolutely-positioned DOM overlay via `@moku-labs/web`. This matches every prior framework design call (`audio` chose native WebAudio, `vfx` chose ECS-native particles), keeps the entire game inside one canvas, and avoids a second rendering/layout system that would have to be kept aligned over the canvas across resize/DPR. A title that genuinely needs DOM chrome (e.g. an HTML settings form) can still compose `@moku-labs/web` at the **app layer** — that is for mounting the *canvas*, not for building UI. A responsive layout engine (safe-area insets, reflow, flex/grid) is a documented **deferred** enhancement; this plugin ships absolute screen-space positioning with anchors.

## Screen stack (modal capture)

Each `pushScreen(spec)` builds one Pixi `Container` — an optional full-viewport dimming **backdrop** behind a set of widgets — and adds it on top of the stack. **Only the TOP screen's buttons are tappable** while the stack is non-empty (modal capture); a pushed screen therefore captures pointer input away from the HUD and lower screens. `popScreen` / `replaceScreen` / `clearScreens` **destroy** the container(s) they remove; the HUD is never touched.

```ts
// Pause modal (the consumer composes ui + loop — ui never calls loop itself):
function pause() {
  app.loop.stop();
  app.ui.pushScreen({
    backdrop: {},
    widgets: [
      { kind: "panel", x: 250, y: 200, width: 300, height: 200, radius: 12, children: [
        { kind: "label", text: "Paused", x: 150, y: 40 },
        { kind: "button", text: "Resume", x: 150, y: 130, width: 180, height: 48,
          onTap: () => { app.ui.popScreen(); app.loop.start(); } }
      ]}
    ]
  });
}
```

## Widgets

Four plain-data widget kinds, positioned in **screen space** (CSS px). Style fields omitted in a spec fall back to the plugin's theme `config` (see below).

- **`label`** — a Pixi `Text`. Optional `color` / `fontSize` / `fontFamily`. Default anchor `{0.5, 0.5}` (centered).
- **`button`** — a filled background + centered caption. `onTap` fires on **release over the same button armed on press**. Give an explicit `width` / `height` for a precise hit-area, or omit them for a documented text-estimate fallback. Idle → hover fill is re-painted as the pointer enters/leaves.
- **`panel`** — a filled (optionally rounded) card with `children`, each positioned **relative to the panel's origin**. Nested widgets' hit-rects accumulate the panel offset.
- **`bar`** — a track + a fill scaled horizontally to `value / max` (a health/progress bar). `setValue` is a cheap `scale.x` write.

Widgets given a spec `id` are addressable inside a pushed screen via `getWidget(screen, id)` (which searches panel children).

## HUD + live mutation

`addHud(spec)` builds a **persistent** widget that lives outside the screen stack — a score `label`, a health `bar`, an always-visible pause `button`. HUD buttons are tappable **only when the screen stack is empty** (gameplay); a modal screen captures input away from them. Mutate any live widget imperatively through its handle:

- `setText(handle, text)` — update a `label` / `button` caption.
- `setValue(handle, value)` — update a `bar` (clamped to `[0, max]`).
- `setVisible(handle, visible)` — show/hide a widget.
- `removeHud(handle)` — remove + destroy a HUD widget (and drop its buttons from the hit-set).

## Pointer hit-testing

A single `"update"`-stage system reads `input.snapshot().pointer` each frame and computes its own **press/release edges** from the button bitmask (the input snapshot exposes `justPressed`/`justReleased` for keys only, not pointer buttons). A button's `onTap` fires on **pointer-up over the same button that was armed on pointer-down** — a press that drifts off the button, or a release over a button that was not armed, fires nothing. The active button set is the top screen's (modal) or, with an empty stack, the HUD's.

## Headless-safe

With no Pixi stage (`renderer.getStage()` undefined — the renderer's headless contract), the UI root is never created, and **every API method + the hit-test system are guarded no-ops**: `pushScreen`/`addHud` return a handle but build nothing, mutations do nothing, and a headless host boots + ticks without throwing. This mirrors the renderer's own headless behaviour.

## Lifecycle & disposal

`onStart` (deps-ready wiring, the renderer/`vfx` shape) captures `renderer.getStage()`, builds the UI root over the game entities when a stage exists, and registers the hit-test system. There is **no `onStop`**: every Pixi object `ui` builds is parented under the **renderer-owned stage**, so the renderer disposes the whole subtree on shutdown; in-run disposal (`popScreen`/`clearScreens`/`replaceScreen`/`removeHud`) is handled by the API, which destroys the container it removes. `ui`'s own state is plain GC-able data.

## API

Accessed as `app.ui.*` after `createApp()`. Every method is a guarded no-op before `app.start()` / when headless and on stale / wrong-kind handles.

### Screen stack

- `pushScreen(spec: ScreenSpec): ScreenHandle` — build + push a screen; returns its handle.
- `popScreen(): void` — remove + destroy the top screen.
- `replaceScreen(spec: ScreenSpec): ScreenHandle` — `popScreen()` then `pushScreen(spec)`.
- `clearScreens(): void` — remove + destroy every screen (HUD untouched).
- `topScreen(): ScreenHandle | undefined` — the top handle, or `undefined`.
- `screenCount(): number` — the stack depth.

### HUD + mutation

- `addHud(spec: WidgetSpec): WidgetHandle` — build a persistent HUD widget.
- `removeHud(handle: WidgetHandle): void` — remove + destroy a HUD widget.
- `getWidget(screen: ScreenHandle, id: string): WidgetHandle | undefined` — resolve a screen widget by spec `id`.
- `setText(handle, text): void` / `setValue(handle, value): void` / `setVisible(handle, visible): void`.

### Advanced

- `getRoot(): Container | undefined` — the UI root `Container` for advanced composition (or `undefined` before start / when headless).

## Configuration

Theme defaults + the reference viewport. Colors are hex ints; sizes are CSS px.

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `textColor` | `number` | `0xffffff` | Default text color. |
| `fontSize` | `number` | `20` | Default font size (px). |
| `fontFamily` | `string` | `"sans-serif"` | Default font family. |
| `buttonColor` | `number` | `0x3355ff` | Button idle fill. |
| `buttonHoverColor` | `number` | `0x4466ff` | Button hover/press fill. |
| `panelColor` | `number` | `0x141821` | Panel/card fill. |
| `panelAlpha` | `number` | `0.92` | Panel/card fill alpha. |
| `backdropColor` | `number` | `0x000000` | Modal backdrop fill. |
| `backdropAlpha` | `number` | `0.6` | Modal backdrop alpha. |
| `padding` | `number` | `12` | Uniform inner padding for buttons/panels (px). |
| `width` | `number` | `800` | Reference viewport width (CSS px) — a screen `backdrop` fills `width × height`. Set to match the renderer's canvas width. |
| `height` | `number` | `600` | Reference viewport height (CSS px). |

> **Why `width`/`height` are config:** `ui` needs the canvas size to fill a modal backdrop, but the `renderer` exposes only `getStage()` (a screen-agnostic Pixi `Container`), not its dimensions. Rather than couple `ui` to renderer internals, the reference viewport is configured here; set it to match your renderer's `width`/`height`.

```ts
const app = createApp({
  pluginConfigs: {
    ui: { width: 1280, height: 720, buttonColor: 0x2244cc, fontFamily: "monospace" }
  }
});
```

## Dependencies

- **`renderer`** — `getStage()` to parent the UI root; the stage owns disposal of everything under it.
- **`scheduler`** — `addSystem("update", …)` to register the pointer hit-test system.
- **`input`** — `snapshot().pointer` (`{ x, y, buttons }`) each frame.

Not `ecs` (the scheduler already depends on it — a UI node is never entity/`Transform`-bound) and not `loop` (pause/resume is composed by the consumer, keeping `ui` a decoupled leaf).

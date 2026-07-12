/**
 * @file ui plugin — type definitions.
 *
 * All Pixi types are confined to the ui domain files (`widgets.ts` builds the Pixi
 * objects; `lifecycle.ts` creates the root via a `widgets.ts` helper). Nothing
 * leaks past the plugin boundary except the structural `Container` handle returned
 * by `getRoot()` and stored on state — exactly as the renderer/vfx scope it.
 */
import type { Container } from "pixi.js";

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ui plugin configuration — theme defaults applied when a widget spec omits a
 * style field. Colors are hex ints (e.g. `0x3355ff`); sizes are in screen-space
 * (CSS) pixels.
 */
export type Config = {
  /**
   * Default text color.
   *
   * @default 0xffffff
   */
  textColor: number;
  /**
   * Default font size in px.
   *
   * @default 20
   */
  fontSize: number;
  /**
   * Default font family.
   *
   * @default "sans-serif"
   */
  fontFamily: string;
  /**
   * Button idle fill color.
   *
   * @default 0x3355ff
   */
  buttonColor: number;
  /**
   * Button hover/press fill color.
   *
   * @default 0x4466ff
   */
  buttonHoverColor: number;
  /**
   * Panel/card fill color.
   *
   * @default 0x141821
   */
  panelColor: number;
  /**
   * Panel/card fill alpha, 0–1.
   *
   * @default 0.92
   */
  panelAlpha: number;
  /**
   * Modal backdrop fill color (used when a {@link ScreenSpec} requests a backdrop).
   *
   * @default 0x000000
   */
  backdropColor: number;
  /**
   * Modal backdrop alpha, 0–1.
   *
   * @default 0.6
   */
  backdropAlpha: number;
  /**
   * Uniform inner padding for buttons/panels in px.
   *
   * @default 12
   */
  padding: number;
  /**
   * Reference viewport width (CSS px) — the ui's screen-space coordinate frame.
   * A screen `backdrop` fills `width × height`, so set this to match the
   * renderer's canvas width. (The renderer exposes only `getStage()`, not its
   * dimensions, so the viewport is configured here rather than read back.)
   *
   * @default 800
   */
  width: number;
  /**
   * Reference viewport height (CSS px) — see {@link Config.width}.
   *
   * @default 600
   */
  height: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Opaque handles
// ─────────────────────────────────────────────────────────────────────────────

/** Opaque handle to a pushed screen. The `kind` literal makes it nominally distinct from {@link WidgetHandle}. */
export type ScreenHandle = { readonly kind: "screen"; readonly id: number };

/** Opaque handle to a widget (HUD, or a screen widget resolved via `getWidget`). */
export type WidgetHandle = { readonly kind: "widget"; readonly id: number };

// ─────────────────────────────────────────────────────────────────────────────
// Internal view/handle shapes
// ─────────────────────────────────────────────────────────────────────────────

/** Axis-aligned screen-space hit-rect (CSS px) computed at build time, accumulating panel offsets. */
export type Rect = { x: number; y: number; w: number; h: number };

/** A live bar runtime: its fill node (scaled horizontally by `value/max`) + geometry. */
export type BarView = {
  /** The fill Graphics (as `Container`); its `scale.x` is set to `value/max`. */
  readonly fill: Container;
  /** Current value (clamped to `[0, max]`). */
  value: number;
  /** Maximum value. */
  readonly max: number;
  /** Track/fill width in px. */
  readonly width: number;
  /** Track/fill height in px. */
  readonly height: number;
  /** Fill color, hex int. */
  readonly color: number;
};

/** A live, tappable button: its display node, absolute screen-space rect, callback, and hover state. */
export type ButtonView = {
  /** The button's Pixi Container (bg Graphics + Text). */
  readonly node: Container;
  /** The fill Graphics, re-filled on hover/press (idle ↔ hover color). */
  readonly bg: Container;
  /** Absolute screen-space AABB used for hit-testing. */
  readonly rect: Rect;
  /** Fired on pointer-up over this button when it was armed on pointer-down. */
  readonly onTap: () => void;
  /** Whether the pointer is currently over this button (drives the hover fill). */
  hovered: boolean;
  /** Idle fill color, hex int. */
  readonly idleColor: number;
  /** Hover/press fill color, hex int. */
  readonly hoverColor: number;
};

/** A live widget addressable by handle for `setText`/`setValue`/`setVisible`. */
export type WidgetView = {
  /** Stable numeric id — the {@link WidgetHandle} `id` that resolves back to this view. */
  readonly id: number;
  /** Discriminant used to guard mutation methods (setText only on label/button, setValue only on bar). */
  readonly kind: "label" | "button" | "panel" | "bar";
  /** The widget's root Pixi node (for `setVisible`). */
  readonly node: Container;
  /** The Pixi `Text` node (label/button only) — target of `setText`. */
  readonly text?: Container;
  /** The bar runtime (bar only) — target of `setValue`. */
  readonly bar?: BarView;
};

/** One entry in the screen stack. */
export type Screen = {
  /** This screen's opaque handle. */
  readonly handle: ScreenHandle;
  /** The screen's root Container, added to `state.root`; destroyed on pop/clear/replace. */
  readonly container: Container;
  /** This screen's tappable buttons (active only while it is the TOP screen). */
  readonly buttons: ButtonView[];
  /** Spec `id` → view, for `getWidget` (populated recursively through panel children). */
  readonly widgets: Map<string, WidgetView>;
};

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ui plugin mutable state.
 *
 * Holds only plain, GC-able data plus the ui-owned Pixi handles. There is **no**
 * `ctx.global` WeakMap: like vfx, ui owns **no** external OS/GPU resource of its
 * own — every Pixi object it builds is parented under the renderer-owned stage, so
 * shutdown disposal is the renderer's responsibility. In-run disposal (pop / clear /
 * removeHud) is handled by the API methods, which `destroy()` the container they remove.
 */
export type State = {
  /** UI root Container, added to the stage in onStart. `undefined` before start / when headless. */
  root: Container | undefined;
  /** Screen stack, bottom→top. Each entry owns a Pixi Container + its live button hit-regions. */
  readonly screens: Screen[];
  /** Persistent HUD widgets (outside the stack), keyed by handle id. */
  readonly hud: Map<number, WidgetView>;
  /** HUD buttons eligible for hit-testing when the screen stack is empty (gameplay). */
  readonly hudButtons: ButtonView[];
  /** Pointer button bitmask observed on the previous frame (press/release edge detection). */
  prevButtons: number;
  /** The button armed on pointer-down; fires `onTap` iff released over the SAME button. */
  armed: ButtonView | undefined;
  /** Monotonic id source for screen/widget handles. */
  nextId: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Declarative widget + screen specs (plain data — no Pixi types)
// ─────────────────────────────────────────────────────────────────────────────

/** Common widget fields. Position is screen-space (CSS px); anchor is a 0–1 pivot. */
export type BaseWidget = {
  /** Optional id for `getWidget(screen, id)` lookup within a pushed screen. */
  id?: string;
  /** Screen-space x in CSS px (default 0). Relative to the parent panel when nested. */
  x?: number;
  /** Screen-space y in CSS px (default 0). Relative to the parent panel when nested. */
  y?: number;
  /** Pivot 0–1 (default label/button `{0.5,0.5}`, panel/bar `{0,0}`). */
  anchor?: { x: number; y: number };
  /** Initial visibility (default true). */
  visible?: boolean;
};

/** A text label. */
export type LabelSpec = BaseWidget & {
  /** Widget discriminant. */
  kind: "label";
  /** The string to render. */
  text: string;
  /** Text color; default `config.textColor`. */
  color?: number;
  /** Font size in px; default `config.fontSize`. */
  fontSize?: number;
  /** Font family; default `config.fontFamily`. */
  fontFamily?: string;
};

/** A tappable button (bg rect + centered label). */
export type ButtonSpec = BaseWidget & {
  /** Widget discriminant. */
  kind: "button";
  /** The button caption. */
  text: string;
  /** Fired on pointer-up over the button when it was armed on pointer-down. */
  onTap: () => void;
  /** Explicit hit-area width (CSS px). Omit → estimated from text (documented fallback). */
  width?: number;
  /** Explicit hit-area height (CSS px). Omit → estimated from text. */
  height?: number;
  /** Idle fill; default `config.buttonColor`. */
  color?: number;
  /** Hover/press fill; default `config.buttonHoverColor`. */
  hoverColor?: number;
  /** Caption color; default `config.textColor`. */
  textColor?: number;
  /** Caption font size in px; default `config.fontSize`. */
  fontSize?: number;
};

/** A filled panel/card that positions child widgets relative to its origin. */
export type PanelSpec = BaseWidget & {
  /** Widget discriminant. */
  kind: "panel";
  /** Panel width in px. */
  width: number;
  /** Panel height in px. */
  height: number;
  /** Fill color; default `config.panelColor`. */
  color?: number;
  /** Fill alpha 0–1; default `config.panelAlpha`. */
  alpha?: number;
  /** Corner radius in px; default 0. */
  radius?: number;
  /** Child widgets, positioned relative to this panel's origin. */
  children?: WidgetSpec[];
};

/** A value bar (track + horizontally-scaled fill). */
export type BarSpec = BaseWidget & {
  /** Widget discriminant. */
  kind: "bar";
  /** Current value. */
  value: number;
  /** Maximum value. */
  max: number;
  /** Bar width in px. */
  width: number;
  /** Bar height in px. */
  height: number;
  /** Fill color; default `config.buttonColor`. */
  color?: number;
  /** Track color; default `config.panelColor`. */
  background?: number;
  /** Corner radius in px; default 0. */
  radius?: number;
};

/** The declarative widget union — a discriminated union on `kind`. */
export type WidgetSpec = LabelSpec | ButtonSpec | PanelSpec | BarSpec;

/** A screen = a full-canvas layer of widgets, optionally over a dimming backdrop. */
export type ScreenSpec = {
  /** Full-canvas dimming rect behind the widgets. Omitted fields fall back to `config.backdrop*`. */
  backdrop?: { color?: number; alpha?: number };
  /** The widgets on this screen. */
  widgets: WidgetSpec[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Public API surface
// ─────────────────────────────────────────────────────────────────────────────

/** The ui plugin public API (exposed as `app.ui`). */
export type Api = {
  // ── Screen stack ───────────────────────────────────────────────
  /**
   * Build `spec` into a Container, add it on top of the stack, and return its
   * handle. Only the TOP screen's buttons are tappable (modal capture). Headless
   * / before start → returns a handle but builds nothing.
   *
   * @param spec - The screen (widgets + optional backdrop) to push.
   * @returns The new top screen's handle.
   */
  pushScreen(spec: ScreenSpec): ScreenHandle;
  /**
   * Remove + destroy the top screen (no-op if the stack is empty).
   */
  popScreen(): void;
  /**
   * `popScreen()` then `pushScreen(spec)`.
   *
   * @param spec - The replacement screen.
   * @returns The new top screen's handle.
   */
  replaceScreen(spec: ScreenSpec): ScreenHandle;
  /**
   * Remove + destroy every screen (the HUD is untouched).
   */
  clearScreens(): void;
  /**
   * The top screen's handle, or `undefined` when the stack is empty.
   *
   * @returns The top {@link ScreenHandle} or `undefined`.
   */
  topScreen(): ScreenHandle | undefined;
  /**
   * The number of screens on the stack.
   *
   * @returns The stack depth.
   */
  screenCount(): number;

  // ── HUD (persistent, outside the stack) ────────────────────────
  /**
   * Build a persistent HUD widget and return its handle. HUD buttons are tappable
   * only when the screen stack is empty (gameplay); a modal screen captures input.
   * Headless / before start → returns a handle but builds nothing.
   *
   * @param spec - The widget to add to the HUD.
   * @returns The widget handle.
   */
  addHud(spec: WidgetSpec): WidgetHandle;
  /**
   * Remove + destroy a HUD widget (no-op for an unknown/stale handle).
   *
   * @param handle - The HUD widget handle to remove.
   */
  removeHud(handle: WidgetHandle): void;

  // ── Mutate a live widget (HUD handle, or a screen widget via getWidget) ──
  /**
   * Resolve a widget inside a pushed screen by its spec `id` (searches panel children).
   *
   * @param screen - The screen to search.
   * @param id - The widget's spec `id`.
   * @returns The widget handle, or `undefined` for an unknown id / stale screen.
   */
  getWidget(screen: ScreenHandle, id: string): WidgetHandle | undefined;
  /**
   * Update a label/button's text. No-op for a non-text widget / stale handle.
   *
   * @param handle - The widget handle.
   * @param text - The new text.
   */
  setText(handle: WidgetHandle, text: string): void;
  /**
   * Update a bar's current value (clamped to `[0, max]`); resizes its fill. No-op
   * for a non-bar / stale handle.
   *
   * @param handle - The widget handle.
   * @param value - The new value.
   */
  setValue(handle: WidgetHandle, value: number): void;
  /**
   * Show/hide a widget's node.
   *
   * @param handle - The widget handle.
   * @param visible - Whether the widget should be visible.
   */
  setVisible(handle: WidgetHandle, visible: boolean): void;

  // ── Advanced ───────────────────────────────────────────────────
  /**
   * The UI root Container (advanced composition), or `undefined` before start / when headless.
   *
   * @returns The root Container or `undefined`.
   */
  getRoot(): Container | undefined;
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared structural dependency types (reused by lifecycle.ts + system.ts + tests)
// ─────────────────────────────────────────────────────────────────────────────

/** Logger surface injected by the common logPlugin (`ctx.log`). */
export type Log = {
  /** Log at debug level. */
  debug(message: string): void;
  /** Log at info level. */
  info(message: string): void;
  /** Log a warning. */
  warn(message: string): void;
  /** Log an error. */
  error(message: string): void;
};

/**
 * The slice of the renderer API ui uses — a structural type (rather than the full
 * renderer `Api`) so tests can pass a minimal mock. ui uses **only** `getStage()`:
 * it builds and manages its own screen-space subtree directly rather than routing
 * per-widget `attach`.
 */
export type RendererDep = {
  /** The root stage Container, or `undefined` when headless / before start. */
  getStage(): Container | undefined;
};

/** Per-frame pointer read from the input snapshot (CSS px + button bitmask). */
export type PointerSnapshot = { readonly x: number; readonly y: number; readonly buttons: number };

/**
 * The slice of the input API the hit-test system reads each frame — `snapshot().pointer`.
 * Structural so unit tests can supply a scripted pointer without the full input plugin.
 */
export type InputDep = {
  /** Returns the current frame's snapshot; ui reads only its `pointer`. */
  snapshot(): { readonly pointer: PointerSnapshot };
};

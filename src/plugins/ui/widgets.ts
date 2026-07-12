/**
 * @file ui plugin — Pixi widget/screen construction.
 *
 * The one place that constructs Pixi objects (`Container` / `Graphics` / `Text`),
 * so Pixi stays confined to this domain file. Turns plain-data {@link WidgetSpec} /
 * {@link ScreenSpec} into Pixi subtrees and, along the way, accumulates the
 * absolute-screen-space {@link ButtonView} hit-rects (offsets accumulate through
 * nested panels) and the `id → view` map used by `getWidget`.
 *
 * Pixi scene-graph objects construct and mutate fine in Node without a GPU, so this
 * module is exercised directly by the widget/screen/system unit tests.
 */
import { Container, Graphics, Text } from "pixi.js";
import type { BarView, ButtonView, Config, ScreenSpec, WidgetSpec, WidgetView } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clamp `v` into the inclusive `[lo, hi]` range.
 *
 * @param v - The value to clamp.
 * @param lo - Lower bound.
 * @param hi - Upper bound.
 * @returns `v` constrained to `[lo, hi]`.
 * @example
 * ```ts
 * clamp(120, 0, 100); // 100
 * ```
 */
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Average glyph width as a fraction of font size, for the button hit-area estimate. */
const GLYPH_WIDTH_RATIO = 0.6;

/**
 * Estimate a button's hit-area when its spec omits `width`/`height`. A deliberately
 * rough heuristic (average glyph ≈ `0.6 × fontSize` wide) padded on all sides — the
 * documented fallback; pass explicit `width`/`height` for a precise hit-area.
 *
 * @param text - The button caption.
 * @param fontSize - The resolved caption font size in px.
 * @param padding - The resolved uniform inner padding in px.
 * @returns The estimated `{ w, h }` in px.
 * @example
 * ```ts
 * estimateButtonSize("Play", 20, 12); // ~{ w: 72, h: 44 }
 * ```
 */
const estimateButtonSize = (
  text: string,
  fontSize: number,
  padding: number
): { w: number; h: number } => ({
  w: Math.ceil(text.length * fontSize * GLYPH_WIDTH_RATIO) + padding * 2,
  h: Math.ceil(fontSize) + padding * 2
});

/** Accumulators threaded through a recursive build (one screen or one HUD widget). */
type BuildContext = {
  /** Resolved ui theme config (fills style defaults). */
  readonly config: Readonly<Config>;
  /** Collects every button built, in build (paint) order — the hit-test set. */
  readonly buttons: ButtonView[];
  /** Collects widgets that carry a spec `id`, for `getWidget` (recursive through panels). */
  readonly byId: Map<string, WidgetView>;
  /** Mint the next monotonic widget id (shared with the plugin's handle counter). */
  readonly nextId: () => number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Per-kind builders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a `label` — a Pixi `Text` anchored by its 0–1 pivot (default centered).
 *
 * @param spec - The label spec.
 * @param ctx - The build accumulators (config supplies style defaults).
 * @returns The Text node + its view.
 * @example
 * ```ts
 * const { node } = buildLabel({ kind: "label", text: "Score" }, ctx);
 * ```
 */
const buildLabel = (
  spec: Extract<WidgetSpec, { kind: "label" }>,
  ctx: BuildContext
): { node: Container; view: WidgetView } => {
  const anchor = spec.anchor ?? { x: 0.5, y: 0.5 };

  const node = new Text({
    text: spec.text,
    style: {
      fontSize: spec.fontSize ?? ctx.config.fontSize,
      fill: spec.color ?? ctx.config.textColor,
      fontFamily: spec.fontFamily ?? ctx.config.fontFamily
    }
  });
  node.anchor.set(anchor.x, anchor.y);
  node.position.set(spec.x ?? 0, spec.y ?? 0);
  node.visible = spec.visible ?? true;

  return { node, view: { id: ctx.nextId(), kind: "label", node, text: node } };
};

/**
 * Build a `button` — a Container holding a fill `Graphics` (re-filled on hover) and
 * a centered caption. Registers the {@link ButtonView} (with its absolute hit-rect)
 * into `ctx.buttons`.
 *
 * @param spec - The button spec.
 * @param ax - Absolute screen-space X of the parent origin (accumulated panel offset).
 * @param ay - Absolute screen-space Y of the parent origin.
 * @param ctx - The build accumulators.
 * @returns The Container node + its view.
 * @example
 * ```ts
 * const { node } = buildButton({ kind: "button", text: "Play", onTap }, 0, 0, ctx);
 * ```
 */
const buildButton = (
  spec: Extract<WidgetSpec, { kind: "button" }>,
  ax: number,
  ay: number,
  ctx: BuildContext
): { node: Container; view: WidgetView } => {
  const anchor = spec.anchor ?? { x: 0.5, y: 0.5 };
  const fontSize = spec.fontSize ?? ctx.config.fontSize;
  const px = spec.x ?? 0;
  const py = spec.y ?? 0;

  // Explicit hit-area, or the documented text-estimate fallback per missing dimension.
  const est = estimateButtonSize(spec.text, fontSize, ctx.config.padding);
  const w = spec.width ?? est.w;
  const h = spec.height ?? est.h;

  const idleColor = spec.color ?? ctx.config.buttonColor;
  const hoverColor = spec.hoverColor ?? ctx.config.buttonHoverColor;

  const bg = new Graphics();
  bg.rect(0, 0, w, h).fill({ color: idleColor });

  const caption = new Text({
    text: spec.text,
    style: {
      fontSize,
      fill: spec.textColor ?? ctx.config.textColor,
      fontFamily: ctx.config.fontFamily
    }
  });
  caption.anchor.set(0.5);
  caption.position.set(w / 2, h / 2);

  const node = new Container();
  node.addChild(bg);
  node.addChild(caption);
  node.pivot.set(anchor.x * w, anchor.y * h);
  node.position.set(px, py);
  node.visible = spec.visible ?? true;

  // Absolute AABB: parent origin + local position, back-shifted by the pivot.
  const rect = { x: ax + px - anchor.x * w, y: ay + py - anchor.y * h, w, h };
  ctx.buttons.push({ node, bg, rect, onTap: spec.onTap, hovered: false, idleColor, hoverColor });

  return { node, view: { id: ctx.nextId(), kind: "button", node, text: caption } };
};

/**
 * Build a `panel` — a filled (optionally rounded) card that positions its children
 * relative to its own origin (their absolute offsets accumulate through this panel).
 *
 * @param spec - The panel spec.
 * @param ax - Absolute screen-space X of the parent origin.
 * @param ay - Absolute screen-space Y of the parent origin.
 * @param ctx - The build accumulators.
 * @returns The Container node + its view.
 * @example
 * ```ts
 * const { node } = buildPanel({ kind: "panel", width: 300, height: 200, children: [] }, 0, 0, ctx);
 * ```
 */
const buildPanel = (
  spec: Extract<WidgetSpec, { kind: "panel" }>,
  ax: number,
  ay: number,
  ctx: BuildContext
): { node: Container; view: WidgetView } => {
  const anchor = spec.anchor ?? { x: 0, y: 0 };
  const px = spec.x ?? 0;
  const py = spec.y ?? 0;
  const { width: w, height: h } = spec;

  const bg = new Graphics();
  const radius = spec.radius ?? 0;
  if (radius > 0) bg.roundRect(0, 0, w, h, radius);
  else bg.rect(0, 0, w, h);
  bg.fill({
    color: spec.color ?? ctx.config.panelColor,
    alpha: spec.alpha ?? ctx.config.panelAlpha
  });

  const node = new Container();
  node.addChild(bg);
  node.pivot.set(anchor.x * w, anchor.y * h);
  node.position.set(px, py);
  node.visible = spec.visible ?? true;

  // Children hang off this panel's origin (its top-left after the pivot shift).
  const originX = ax + px - anchor.x * w;
  const originY = ay + py - anchor.y * h;
  for (const child of spec.children ?? []) {
    node.addChild(buildWidget(child, originX, originY, ctx).node);
  }

  return { node, view: { id: ctx.nextId(), kind: "panel", node } };
};

/**
 * Build a `bar` — a track `Graphics` plus a fill `Graphics` drawn full-width and
 * horizontally scaled to `value / max` (so `setValue` is a cheap `scale.x` write).
 *
 * @param spec - The bar spec.
 * @param ctx - The build accumulators.
 * @returns The Container node + its view (carrying the {@link BarView} runtime).
 * @example
 * ```ts
 * const { node } = buildBar({ kind: "bar", value: 100, max: 100, width: 160, height: 12 }, ctx);
 * ```
 */
const buildBar = (
  spec: Extract<WidgetSpec, { kind: "bar" }>,
  ctx: BuildContext
): { node: Container; view: WidgetView } => {
  const anchor = spec.anchor ?? { x: 0, y: 0 };
  const { width: w, height: h } = spec;
  const radius = spec.radius ?? 0;
  const color = spec.color ?? ctx.config.buttonColor;
  const value = clamp(spec.value, 0, spec.max);

  const track = new Graphics();
  if (radius > 0) track.roundRect(0, 0, w, h, radius);
  else track.rect(0, 0, w, h);
  track.fill({ color: spec.background ?? ctx.config.panelColor });

  const fill = new Graphics();
  fill.rect(0, 0, w, h).fill({ color });
  fill.scale.set(spec.max === 0 ? 0 : value / spec.max, 1);

  const node = new Container();
  node.addChild(track);
  node.addChild(fill);
  node.pivot.set(anchor.x * w, anchor.y * h);
  node.position.set(spec.x ?? 0, spec.y ?? 0);
  node.visible = spec.visible ?? true;

  const bar: BarView = { fill, value, max: spec.max, width: w, height: h, color };
  return { node, view: { id: ctx.nextId(), kind: "bar", node, bar } };
};

/**
 * Build one widget of any kind at the given absolute parent origin, recording it in
 * the shared accumulators (buttons + `id` map). Dispatches on the spec discriminant.
 *
 * @param spec - The widget spec.
 * @param ax - Absolute screen-space X of the parent origin.
 * @param ay - Absolute screen-space Y of the parent origin.
 * @param ctx - The build accumulators.
 * @returns The built Pixi node + its addressable view.
 * @example
 * ```ts
 * const { node, view } = buildWidget(spec, 0, 0, ctx);
 * ```
 */
const buildWidget = (
  spec: WidgetSpec,
  ax: number,
  ay: number,
  ctx: BuildContext
): { node: Container; view: WidgetView } => {
  const built = dispatchBuild(spec, ax, ay, ctx);

  // Only widgets given a spec `id` are addressable via getWidget.
  if (spec.id !== undefined) ctx.byId.set(spec.id, built.view);

  return built;
};

/**
 * Dispatch a widget spec to its kind-specific builder.
 *
 * @param spec - The widget spec.
 * @param ax - Absolute screen-space X of the parent origin.
 * @param ay - Absolute screen-space Y of the parent origin.
 * @param ctx - The build accumulators.
 * @returns The built node + its view.
 * @example
 * ```ts
 * const built = dispatchBuild(spec, 0, 0, ctx);
 * ```
 */
const dispatchBuild = (
  spec: WidgetSpec,
  ax: number,
  ay: number,
  ctx: BuildContext
): { node: Container; view: WidgetView } => {
  switch (spec.kind) {
    case "label": {
      return buildLabel(spec, ctx);
    }
    case "button": {
      return buildButton(spec, ax, ay, ctx);
    }
    case "panel": {
      return buildPanel(spec, ax, ay, ctx);
    }
    case "bar": {
      return buildBar(spec, ctx);
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Public builders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create the empty UI root Container (added to the renderer stage in onStart).
 *
 * @returns A labelled root Container.
 * @example
 * ```ts
 * const root = createRoot();
 * stage.addChild(root);
 * ```
 */
export const createRoot = (): Container => {
  const root = new Container();
  root.label = "ui-root";
  return root;
};

/**
 * Build a full screen Container from a {@link ScreenSpec}: an optional full-viewport
 * dimming backdrop behind the widgets, then each top-level widget. Returns the
 * container plus the screen's button hit-set and `id → view` map.
 *
 * @param spec - The screen spec (widgets + optional backdrop).
 * @param config - Resolved ui config (theme defaults + viewport size).
 * @param nextId - Mint the next widget id (the plugin's shared handle counter).
 * @returns The screen container, its buttons, and its `id → view` map.
 * @example
 * ```ts
 * const { container, buttons } = buildScreen(spec, config, () => state.nextId++);
 * root.addChild(container);
 * ```
 */
export const buildScreen = (
  spec: ScreenSpec,
  config: Readonly<Config>,
  nextId: () => number
): { container: Container; buttons: ButtonView[]; byId: Map<string, WidgetView> } => {
  const container = new Container();

  // Backdrop first so it paints behind (and dims) the widgets above it.
  if (spec.backdrop) {
    const backdrop = new Graphics();
    backdrop.rect(0, 0, config.width, config.height).fill({
      color: spec.backdrop.color ?? config.backdropColor,
      alpha: spec.backdrop.alpha ?? config.backdropAlpha
    });
    container.addChild(backdrop);
  }

  const buttons: ButtonView[] = [];
  const byId = new Map<string, WidgetView>();
  const ctx: BuildContext = { config, buttons, byId, nextId };
  for (const widget of spec.widgets) {
    container.addChild(buildWidget(widget, 0, 0, ctx).node);
  }

  return { container, buttons, byId };
};

/**
 * Build a single persistent HUD widget from a {@link WidgetSpec}, returning its
 * node, its addressable view, and any tappable buttons it contains (a HUD panel may
 * nest buttons — all of them join the HUD hit-set).
 *
 * @param spec - The HUD widget spec.
 * @param config - Resolved ui config.
 * @param nextId - Mint the next widget id.
 * @returns The node, its view, and the buttons it contains.
 * @example
 * ```ts
 * const { node, view } = buildHudWidget({ kind: "label", text: "0" }, config, () => state.nextId++);
 * root.addChild(node);
 * ```
 */
export const buildHudWidget = (
  spec: WidgetSpec,
  config: Readonly<Config>,
  nextId: () => number
): { node: Container; view: WidgetView; buttons: ButtonView[] } => {
  const buttons: ButtonView[] = [];
  const ctx: BuildContext = { config, buttons, byId: new Map(), nextId };
  const built = buildWidget(spec, 0, 0, ctx);
  return { node: built.node, view: built.view, buttons };
};

// ─────────────────────────────────────────────────────────────────────────────
// Mutation helpers (keep Pixi class access confined to this file)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Re-fill a button's background for its hover state (idle ↔ hover color) and record
 * the new state. The `bg` is a `Graphics` (built here); re-filling avoids a GPU tint
 * so it behaves identically headless.
 *
 * @param button - The button view to update.
 * @param hovered - Whether the pointer is now over the button.
 * @example
 * ```ts
 * setButtonHover(button, true); // paint the hover fill
 * ```
 */
export const setButtonHover = (button: ButtonView, hovered: boolean): void => {
  const bg = button.bg as Graphics;
  bg.clear();
  bg.rect(0, 0, button.rect.w, button.rect.h);
  bg.fill({ color: hovered ? button.hoverColor : button.idleColor });
  button.hovered = hovered;
};

/**
 * Set a label/button view's text. No-op for a view with no text node (panel/bar).
 *
 * @param view - The widget view to update.
 * @param text - The new text string.
 * @example
 * ```ts
 * applyText(view, "Score: 1200");
 * ```
 */
export const applyText = (view: WidgetView, text: string): void => {
  if (!view.text) return;
  (view.text as Text).text = text;
};

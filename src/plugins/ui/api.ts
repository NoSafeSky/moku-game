/**
 * @file ui plugin — API factory (the `app.ui` surface).
 *
 * Exposes the screen stack (`pushScreen`/`popScreen`/`replaceScreen`/`clearScreens`/
 * `topScreen`/`screenCount`), the persistent HUD (`addHud`/`removeHud`), live-widget
 * mutation (`getWidget`/`setText`/`setValue`/`setVisible`), and `getRoot`. Every
 * method is a guarded no-op before start / when headless (`state.root` undefined) and
 * on stale / wrong-kind handles — so misuse degrades quietly rather than throwing.
 *
 * Pixi construction lives in `widgets.ts`; this file only wires plain-data specs to
 * those builders and mutates the resulting scene subtree.
 */
import type { Container } from "pixi.js";
import type {
  Api,
  Config,
  ScreenHandle,
  State,
  WidgetHandle,
  WidgetSpec,
  WidgetView
} from "./types";
import { applyText, buildHudWidget, buildScreen } from "./widgets";

/**
 * Structural context required by {@link createApi}, so unit tests can pass a minimal
 * mock without wiring the full kernel. Mirrors the vfx / renderer context pattern.
 */
export type UiApiContext = {
  /** Resolved ui configuration (theme defaults + viewport size). */
  readonly config: Readonly<Config>;
  /** ui plugin state — root, screen stack, HUD, and edge counters. */
  readonly state: State;
};

/**
 * Whether `node` is `ancestor` or sits somewhere beneath it in the scene graph.
 * Used by `removeHud` to drop a HUD widget's (possibly panel-nested) buttons from
 * the hit-set before its subtree is destroyed.
 *
 * @param node - The candidate descendant.
 * @param ancestor - The subtree root to test against.
 * @returns `true` when `node` is within `ancestor`'s subtree.
 * @example
 * ```ts
 * if (isUnder(button.node, widget.node)) drop(button);
 * ```
 */
const isUnder = (node: Container, ancestor: Container): boolean => {
  let cursor: Container | null = node;
  while (cursor) {
    if (cursor === ancestor) return true;
    cursor = cursor.parent;
  }
  return false;
};

/**
 * Creates the ui plugin API surface.
 *
 * @param ctx - Plugin context (structural — only the fields this API uses).
 * @param ctx.config - Resolved ui configuration.
 * @param ctx.state - ui plugin state (root, screens, HUD, edge counters).
 * @returns The ui plugin {@link Api} object.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * const title = api.pushScreen({ widgets: [{ kind: "label", text: "ASCEND", x: 400, y: 200 }] });
 * ```
 */
export const createApi = (ctx: UiApiContext): Api => {
  const { config, state } = ctx;

  /**
   * Mint the next monotonic handle/widget id from the shared counter.
   *
   * @returns The next unique id.
   * @example
   * ```ts
   * const handle = { kind: "screen", id: nextId() };
   * ```
   */
  const nextId = (): number => state.nextId++;

  /**
   * Resolve a widget handle to its live view — searching the HUD first, then every
   * screen's widget map. Returns `undefined` for a stale / unknown handle.
   *
   * @param handle - The widget handle to resolve.
   * @returns The matching {@link WidgetView}, or `undefined`.
   * @example
   * ```ts
   * const view = resolveWidget(handle);
   * ```
   */
  const resolveWidget = (handle: WidgetHandle): WidgetView | undefined => {
    const hudView = state.hud.get(handle.id);
    if (hudView) return hudView;
    for (const screen of state.screens) {
      for (const view of screen.widgets.values()) {
        if (view.id === handle.id) return view;
      }
    }
    return undefined;
  };

  const api: Api = {
    /**
     * Build `spec` into a Container, add it on top of the stack, and return its
     * handle. Headless / before start → returns a handle but builds nothing.
     *
     * @param spec - The screen (widgets + optional backdrop) to push.
     * @returns The new top screen's handle.
     * @example
     * ```ts
     * api.pushScreen({ backdrop: {}, widgets: [{ kind: "button", text: "Resume", onTap }] });
     * ```
     */
    pushScreen(spec): ScreenHandle {
      const handle: ScreenHandle = { kind: "screen", id: nextId() };
      if (!state.root) return handle; // headless — build nothing

      const { container, buttons, byId } = buildScreen(spec, config, nextId);
      state.root.addChild(container);
      state.screens.push({ handle, container, buttons, widgets: byId });
      state.armed = undefined; // the active button set just changed
      return handle;
    },

    /**
     * Remove + destroy the top screen (no-op if the stack is empty).
     *
     * @example
     * ```ts
     * api.popScreen();
     * ```
     */
    popScreen(): void {
      const screen = state.screens.pop();
      if (!screen) return;
      screen.container.destroy({ children: true });
      state.armed = undefined;
    },

    /**
     * `popScreen()` then `pushScreen(spec)`.
     *
     * @param spec - The replacement screen.
     * @returns The new top screen's handle.
     * @example
     * ```ts
     * api.replaceScreen({ widgets: [{ kind: "label", text: "Game Over", x: 400, y: 300 }] });
     * ```
     */
    replaceScreen(spec): ScreenHandle {
      api.popScreen();
      return api.pushScreen(spec);
    },

    /**
     * Remove + destroy every screen (the HUD is untouched).
     *
     * @example
     * ```ts
     * api.clearScreens();
     * ```
     */
    clearScreens(): void {
      while (state.screens.length > 0) api.popScreen();
    },

    /**
     * The top screen's handle, or `undefined` when the stack is empty.
     *
     * @returns The top {@link ScreenHandle} or `undefined`.
     * @example
     * ```ts
     * if (!api.topScreen()) startGame();
     * ```
     */
    topScreen(): ScreenHandle | undefined {
      return state.screens.at(-1)?.handle;
    },

    /**
     * The number of screens on the stack.
     *
     * @returns The stack depth.
     * @example
     * ```ts
     * const paused = api.screenCount() > 0;
     * ```
     */
    screenCount(): number {
      return state.screens.length;
    },

    /**
     * Build a persistent HUD widget and return its handle. Headless / before start →
     * returns a handle but builds nothing.
     *
     * @param spec - The widget to add to the HUD.
     * @returns The widget handle.
     * @example
     * ```ts
     * const score = api.addHud({ kind: "label", text: "0", x: 16, y: 16, anchor: { x: 0, y: 0 } });
     * ```
     */
    addHud(spec: WidgetSpec): WidgetHandle {
      if (!state.root) return { kind: "widget", id: nextId() }; // headless — build nothing

      const { node, view, buttons } = buildHudWidget(spec, config, nextId);
      state.root.addChild(node);
      state.hud.set(view.id, view);
      for (const button of buttons) state.hudButtons.push(button);
      return { kind: "widget", id: view.id };
    },

    /**
     * Remove + destroy a HUD widget (no-op for an unknown / stale handle).
     *
     * @param handle - The HUD widget handle to remove.
     * @example
     * ```ts
     * api.removeHud(score);
     * ```
     */
    removeHud(handle: WidgetHandle): void {
      const view = state.hud.get(handle.id);
      if (!view) return;

      // Drop this widget's buttons from the HUD hit-set BEFORE destroy severs parents.
      for (let index = state.hudButtons.length - 1; index >= 0; index--) {
        const button = state.hudButtons[index];
        if (!button || !isUnder(button.node, view.node)) continue;

        if (state.armed === button) state.armed = undefined;
        state.hudButtons.splice(index, 1);
      }

      view.node.destroy({ children: true });
      state.hud.delete(handle.id);
    },

    /**
     * Resolve a widget inside a pushed screen by its spec `id` (searches panel children).
     *
     * @param screen - The screen to search.
     * @param id - The widget's spec `id`.
     * @returns The widget handle, or `undefined` for an unknown id / stale screen.
     * @example
     * ```ts
     * const bar = api.getWidget(screen, "hp");
     * ```
     */
    getWidget(screen: ScreenHandle, id: string): WidgetHandle | undefined {
      const found = state.screens.find(s => s.handle.id === screen.id);
      const view = found?.widgets.get(id);
      return view ? { kind: "widget", id: view.id } : undefined;
    },

    /**
     * Update a label/button's text. No-op for a non-text widget / stale handle.
     *
     * @param handle - The widget handle.
     * @param text - The new text.
     * @example
     * ```ts
     * api.setText(score, String(currentScore));
     * ```
     */
    setText(handle: WidgetHandle, text: string): void {
      const view = resolveWidget(handle);
      if (view) applyText(view, text);
    },

    /**
     * Update a bar's current value (clamped to `[0, max]`); resizes its fill. No-op
     * for a non-bar / stale handle.
     *
     * @param handle - The widget handle.
     * @param value - The new value.
     * @example
     * ```ts
     * api.setValue(hp, player.health);
     * ```
     */
    setValue(handle: WidgetHandle, value: number): void {
      const view = resolveWidget(handle);
      if (!view?.bar) return;

      const clamped = Math.max(0, Math.min(view.bar.max, value));
      view.bar.value = clamped;
      view.bar.fill.scale.set(view.bar.max === 0 ? 0 : clamped / view.bar.max, 1);
    },

    /**
     * Show/hide a widget's node. No-op for a stale handle.
     *
     * @param handle - The widget handle.
     * @param visible - Whether the widget should be visible.
     * @example
     * ```ts
     * api.setVisible(hp, player.alive);
     * ```
     */
    setVisible(handle: WidgetHandle, visible: boolean): void {
      const view = resolveWidget(handle);
      if (view) view.node.visible = visible;
    },

    /**
     * The UI root Container (advanced composition), or `undefined` before start / when headless.
     *
     * @returns The root Container or `undefined`.
     * @example
     * ```ts
     * api.getRoot()?.addChild(customOverlay);
     * ```
     */
    getRoot(): Container | undefined {
      return state.root;
    }
  };

  return api;
};

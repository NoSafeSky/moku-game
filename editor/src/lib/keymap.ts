/**
 * @file keymap — the editor's global keyboard shortcut table as a PURE key-combo → action map, plus the
 * text-field guard the `shortcuts` island uses to stay out of the way while the user is typing.
 *
 * Kept free of any handle/DOM wiring so both the mapping and the guard are unit-testable in isolation; the
 * island binds each resolved {@link ShortcutAction} to the same bridge / gizmos / camera handles the panels
 * use, so a shortcut is just a second surface onto an existing action (design-context §4).
 */

/** An editor action a global shortcut can trigger. Tool actions map 1:1 onto `gizmos.setMode(...)`. */
export type ShortcutAction =
  | "tool-translate"
  | "tool-rotate"
  | "tool-scale"
  | "tool-rect"
  | "focus"
  | "duplicate"
  | "delete"
  | "undo"
  | "redo"
  | "save"
  | "select-all";

/** The subset of a keyboard event {@link resolveShortcut} reads — so tests need not fabricate a full event. */
export type KeyStroke = {
  /** `event.key` (case-insensitive for letters here). */
  readonly key: string;
  /** Ctrl (Windows/Linux) held. */
  readonly ctrlKey: boolean;
  /** Cmd (macOS) held — treated as the same "mod" as Ctrl. */
  readonly metaKey: boolean;
  /** Shift held (distinguishes Undo from Redo). */
  readonly shiftKey: boolean;
  /** Alt held — any Alt combo is ignored by this map. */
  readonly altKey: boolean;
};

// Plain single-key tool/action bindings (no modifier held): W/E/R/T tools, F focus, Del/Backspace delete.
const PLAIN: Readonly<Record<string, ShortcutAction>> = {
  w: "tool-translate",
  e: "tool-rotate",
  r: "tool-scale",
  t: "tool-rect",
  f: "focus",
  delete: "delete",
  backspace: "delete"
};

// Modifier (Ctrl/Cmd) bindings: Ctrl+D duplicate, Ctrl+S save, Ctrl+A select-all, Ctrl+Y redo.
const MODIFIED: Readonly<Record<string, ShortcutAction>> = {
  d: "duplicate",
  s: "save",
  a: "select-all",
  y: "redo"
};

/**
 * Resolve a keystroke to the editor action it triggers, or `undefined` when it maps to nothing.
 *
 * Undo/redo share `Ctrl+Z` (Shift adds redo); every other modified binding requires Ctrl/Cmd with no
 * Shift; plain bindings require no modifier at all. Any Alt combo is ignored so it never shadows a
 * browser/OS accelerator.
 *
 * @param stroke - The keystroke fields from a `keydown` event.
 * @returns The mapped {@link ShortcutAction}, or `undefined`.
 * @example
 * ```ts
 * resolveShortcut({ key: "z", ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }); // "redo"
 * resolveShortcut({ key: "W", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }); // "tool-translate"
 * ```
 */
export function resolveShortcut(stroke: KeyStroke): ShortcutAction | undefined {
  // Alt is never part of an editor shortcut — leave those to the browser/OS.
  if (stroke.altKey) return undefined;

  const key = stroke.key.toLowerCase();
  const modifier = stroke.ctrlKey || stroke.metaKey;

  // Ctrl/Cmd+Z is undo; add Shift for redo (the standard DCC pairing).
  if (modifier && key === "z") return stroke.shiftKey ? "redo" : "undo";

  // Every other modified binding requires the modifier and no Shift.
  if (modifier && !stroke.shiftKey) return MODIFIED[key];

  // Plain bindings require no modifier and no Shift.
  if (!modifier && !stroke.shiftKey) return PLAIN[key];

  return undefined;
}

/**
 * Whether an event target is a text-entry surface the `shortcuts` island must not steal keys from
 * (an input, textarea, select, or any `contenteditable` element). The standard typing guard.
 *
 * @param target - The event's target (`event.target`).
 * @returns `true` when a shortcut should be suppressed for this target.
 * @example
 * ```ts
 * document.addEventListener("keydown", e => {
 *   if (isTextInputTarget(e.target)) return;
 *   // …dispatch the resolved shortcut
 * });
 * ```
 */
export function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

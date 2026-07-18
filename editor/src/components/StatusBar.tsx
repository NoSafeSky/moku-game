/** @file Status bar — shortcut hint chips + a live scene readout. The status-bar island fills the readout. */

/** One keyboard-shortcut hint chip: a kbd key label + its action name. */
function Hint({ keys, action }: { keys: string; action: string }) {
  return (
    <span data-chip>
      <kbd>{keys}</kbd>
      <span data-chip-action>{action}</span>
    </span>
  );
}

/** The shortcut legend surfaced in the status bar (mirrors the global keymap; see design-context §4). */
const SHORTCUTS: readonly { keys: string; action: string }[] = [
  { keys: "W", action: "Move" },
  { keys: "E", action: "Rotate" },
  { keys: "R", action: "Scale" },
  { keys: "F", action: "Focus" },
  { keys: "Ctrl+D", action: "Duplicate" },
  { keys: "Del", action: "Delete" },
  { keys: "Ctrl+S", action: "Save" }
];

/**
 * The bottom band: a row of keyboard-shortcut hint chips and a right-aligned mono readout the
 * `status-bar` island fills from the snapshot (object / selection counts + mode).
 *
 * @returns The status-bar chrome.
 * @example
 * ```tsx
 * <StatusBar />
 * ```
 */
export function StatusBar() {
  return (
    <footer data-island="status-bar" data-band="status">
      <div data-hints>
        {SHORTCUTS.map(shortcut => (
          <Hint key={shortcut.keys} keys={shortcut.keys} action={shortcut.action} />
        ))}
      </div>
      <span data-mono data-readout aria-live="polite">
        —
      </span>
    </footer>
  );
}

/** @file Toolbar panel — transport + history action buttons; the toolbar island wires clicks + reflects state. */

/** One toolbar action button; the island wires its click and reflects `data-disabled`/`data-mode`. */
function Action({ action, label }: { action: string; label: string }) {
  return (
    <button type="button" data-action={action} title={label}>
      {label}
    </button>
  );
}

/**
 * The second band: history + transport action buttons the toolbar island wires to `bridge.*`. The brand
 * now lives in the menu bar; the transform-tool / pivot-space groups are added when the toolbar extends (A3).
 *
 * @returns The toolbar chrome.
 * @example
 * ```tsx
 * <Toolbar />
 * ```
 */
export function Toolbar() {
  return (
    <section data-island="toolbar" data-band="toolbar" aria-label="Toolbar">
      <div data-group="history">
        <Action action="undo" label="Undo" />
        <Action action="redo" label="Redo" />
      </div>
      <div data-group="playback">
        <Action action="play" label="Play" />
        <Action action="stop" label="Stop" />
        <Action action="step" label="Step" />
      </div>
      <div data-group="persistence">
        <Action action="save" label="Save" />
        <Action action="load" label="Load" />
      </div>
    </section>
  );
}

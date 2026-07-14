/** @file Toolbar panel — static action buttons; the toolbar island wires clicks + reflects state. */

/** One toolbar action button; the island wires its click and reflects `data-disabled`/`data-mode`. */
function Action({ action, label }: { action: string; label: string }) {
  return (
    <button type="button" data-action={action} title={label}>
      {label}
    </button>
  );
}

export function Toolbar() {
  return (
    <section data-island="toolbar" data-panel="toolbar" aria-label="Toolbar">
      <strong data-brand>Moku Editor</strong>
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

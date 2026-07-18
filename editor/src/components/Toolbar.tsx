/** @file Toolbar panel — transform tools + pivot/space + transport + history; the toolbar island wires it. */

/** One history/transport/persistence action button; the island wires its click and reflects `data-disabled`. */
function Action({ action, label }: { action: string; label: string }) {
  return (
    <button type="button" data-action={action} title={label}>
      {label}
    </button>
  );
}

/** One transform-tool button — label + a corner shortcut badge; the island stamps `data-active`. */
function Tool({ tool, label, badge }: { tool: string; label: string; badge: string }) {
  return (
    <button type="button" data-tool={tool} title={`${label} — ${badge}`}>
      <span data-tool-label>{label}</span>
      <span data-badge>{badge}</span>
    </button>
  );
}

/** One two-option segmented control (Pivot⇄Center / Local⇄Global); the island stamps `data-active`. */
function Segment({
  group,
  options
}: {
  group: string;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <div data-segment={group}>
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          data-segment-value={option.value}
          title={option.label}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The second band: the transform-tool group (Move/Rotate/Scale/Rect), the Pivot⇄Center and Local⇄Global
 * segmented toggles, the Play/Stop/Step transport with an EDIT/PLAY mode chip, the history + persistence
 * action groups, and a right-aligned layout-switcher stub. The toolbar island wires every control to
 * `gizmos.*` (tools/pivot/space, direct handles) or `bridge.*` (transport/history/persistence).
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
      <div data-group="tools">
        <Tool tool="translate" label="Move" badge="W" />
        <Tool tool="rotate" label="Rotate" badge="E" />
        <Tool tool="scale" label="Scale" badge="R" />
        <Tool tool="rect" label="Rect" badge="T" />
      </div>

      <Segment
        group="pivot"
        options={[
          { value: "pivot", label: "Pivot" },
          { value: "center", label: "Center" }
        ]}
      />
      <Segment
        group="space"
        options={[
          { value: "local", label: "Local" },
          { value: "global", label: "Global" }
        ]}
      />

      <div data-group="transport">
        <Action action="play" label="Play" />
        <Action action="stop" label="Stop" />
        <Action action="step" label="Step" />
        <span data-mode-chip data-mono>
          EDIT MODE
        </span>
      </div>

      <div data-group="history">
        <Action action="undo" label="Undo" />
        <Action action="redo" label="Redo" />
      </div>
      <div data-group="persistence">
        <Action action="save" label="Save" />
        <Action action="load" label="Load" />
      </div>

      {/* Layout presets (Default / Tall / Wide / 2-by-3) are P4 — this button is an inert stub for now. */}
      <button
        type="button"
        data-layout-stub
        disabled
        title="Saved layouts — coming in a later phase"
      >
        Layout: Default ▾
      </button>
    </section>
  );
}

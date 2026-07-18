/**
 * @file Viewport (Scene View) panel — the letterboxed game canvas + editor camera overlay chrome. The
 * canvas is mounted into `[data-stage]` by editor-host; the viewport island wires the overlay controls and
 * reflects selection + zoom. Picking + the marquee + the gizmo overlay are framework-owned (editor-selection
 * / editor-gizmos paint their own Pixi overlays) — this panel never wires a pointerdown hit-test.
 */

/** One overlay button; the island wires its `data-vp` click. */
function OverlayButton({ vp, label, title }: { vp: string; label: string; title: string }) {
  return (
    <button type="button" data-vp={vp} title={title}>
      {label}
    </button>
  );
}

/**
 * The Scene View panel: a header (title + a Scene|Game tab hint), the aspect-correct letterboxed stage the
 * game canvas mounts into, a top overlay toolbar (grid + snap toggles), and a bottom-right zoom/focus
 * readout bar. The `viewport` island toggles grid via `renderer.setGridVisible`, snap via `gizmos.setSnap`,
 * focus via `camera.focus`, and reflects `camera.getZoom()` into the readout.
 *
 * @returns The viewport chrome.
 * @example
 * ```tsx
 * <Viewport />
 * ```
 */
export function Viewport() {
  return (
    <section data-island="viewport" data-panel="viewport" aria-label="Scene View">
      <header data-vp-header>
        <span data-vp-title>Scene View</span>
        <span data-vp-tabs>
          <button type="button" data-vp-tab data-active>
            Scene
          </button>
          <button
            type="button"
            data-vp-tab
            data-disabled
            title="Game view — coming in a later phase"
          >
            Game
          </button>
        </span>
      </header>

      <div data-vp-body>
        <div data-stage>{/* editor-host appends the <canvas> here at startEditor() */}</div>

        <div data-vp-overlay data-corner="top">
          <OverlayButton vp="grid" label="Grid" title="Toggle grid overlay" />
          <OverlayButton vp="snap" label="Snap" title="Toggle snap-to-grid" />
        </div>

        <div data-vp-overlay data-corner="bottom">
          <OverlayButton vp="zoom-out" label="–" title="Zoom out" />
          <span data-zoom data-mono>
            100%
          </span>
          <OverlayButton vp="zoom-in" label="+" title="Zoom in" />
          <OverlayButton vp="zoom-reset" label="1:1" title="Reset zoom to 100%" />
          <OverlayButton vp="focus" label="Focus" title="Focus selected object — F" />
        </div>
      </div>
    </section>
  );
}

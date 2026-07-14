/** @file Viewport panel — hosts the game canvas (mounted by editor-host) + pointer picking. */
export function Viewport() {
  return (
    <section data-island="viewport" data-panel="viewport" aria-label="Viewport">
      {/* editor-host appends the <canvas> here at startEditor() */}
    </section>
  );
}

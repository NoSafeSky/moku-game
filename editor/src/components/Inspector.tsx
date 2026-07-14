/** @file Inspector panel — the inspector island renders field controls for the selection here. */
export function Inspector() {
  return (
    <section data-island="inspector" data-panel="inspector" aria-label="Inspector">
      <header data-panel-header>
        <h2>Inspector</h2>
      </header>
      <div data-fields aria-live="polite" />
    </section>
  );
}

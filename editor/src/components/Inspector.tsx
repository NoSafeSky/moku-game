/** @file Inspector panel — static shell; the inspector island fills the body with the selection's editors. */
export function Inspector() {
  return (
    <section data-island="inspector" data-panel="inspector" aria-label="Inspector">
      <header data-panel-header>
        <h2>Inspector</h2>
      </header>
      {/* The island rebuilds this on (epoch, selection): object header + component sections + Add-Component,
          the multi-object "N Objects Selected" view, or the no-selection empty state (F7). */}
      <div data-body aria-live="polite" />
    </section>
  );
}

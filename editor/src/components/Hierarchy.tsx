/** @file Hierarchy panel — static chrome for the nested scene tree; the `hierarchy` island fills the tree. */

/**
 * The Hierarchy panel's static shell (design-context B3): a header with Create-Empty / Duplicate / Delete
 * icon buttons, a search field, and the empty scrollable tree container the `hierarchy` island hydrates
 * with rows. Replaces the shipped `SceneTree` panel. All live content — rows, selection, drag indicators,
 * inline rename — is client-rendered by the island; this renders only the inert skeleton.
 *
 * @returns The Hierarchy panel tree.
 * @example
 * ```tsx
 * <Hierarchy />
 * ```
 */
export function Hierarchy() {
  return (
    <section data-island="hierarchy" data-panel="hierarchy" aria-label="Hierarchy">
      <header data-panel-header>
        <h2>Hierarchy</h2>
        <div data-actions>
          <button type="button" data-action="create" title="Create Empty" aria-label="Create Empty">
            +
          </button>
          <button
            type="button"
            data-action="duplicate"
            title="Duplicate (Ctrl+D)"
            aria-label="Duplicate"
          >
            ⧉
          </button>
          <button type="button" data-action="delete" title="Delete (Del)" aria-label="Delete">
            ✕
          </button>
        </div>
      </header>
      <div data-search-row>
        <input type="search" data-search placeholder="Search…" aria-label="Search hierarchy" />
      </div>
      <div data-tree role="tree" aria-label="Scene hierarchy" tabIndex={0} />
    </section>
  );
}

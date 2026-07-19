/** @file Asset-browser panel — the asset-browser island lists assets.entries() ∪ assetStore.entries() here. */

/**
 * The Project / Asset browser panel (design-context §6 B6). Static chrome only: a header with a primary
 * **Import** button and a hidden `<input type=file>` (the island wires both to `assetStore.import`), over an
 * empty `<ul data-assets>` the island fills with tiles (manifest names + imported thumbnails). The hidden
 * input carries `data-action="import-input"` so the menu-bar's Assets ▸ Import New Asset… can trigger it too.
 *
 * @returns The asset-browser chrome.
 * @example
 * ```tsx
 * <AssetBrowser />
 * ```
 */
export function AssetBrowser() {
  return (
    <section data-island="asset-browser" data-panel="asset-browser" aria-label="Asset browser">
      <header data-panel-header>
        <h2>Assets</h2>
        <button type="button" data-action="import" title="Import an image asset">
          Import
        </button>
        <input
          type="file"
          accept="image/*"
          data-action="import-input"
          aria-label="Import image asset"
          hidden
        />
      </header>
      <ul data-assets aria-label="Assets" />
    </section>
  );
}

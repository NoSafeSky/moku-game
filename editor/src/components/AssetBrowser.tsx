/** @file Asset-browser panel — the asset-browser island lists assets.entries() here. */
export function AssetBrowser() {
  return (
    <section data-island="asset-browser" data-panel="asset-browser" aria-label="Asset browser">
      <header data-panel-header>
        <h2>Assets</h2>
      </header>
      <ul data-assets aria-label="Assets" />
    </section>
  );
}

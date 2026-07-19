/**
 * @file Asset-browser island — the Project panel (P2: interactive import + drag-to-scene).
 *
 * Source = `assets.entries()` (framework manifest) ∪ `assetStore.entries()` (imported blobs), rebuilt only
 * when their combined signature changes (loads/imports are orthogonal to world `epoch`, so it polls on its
 * OWN `alias:state` signature — never `epoch`). Manifest tiles keep the P1 name+dimensions text; imported
 * tiles render a thumbnail from the store's `blob:` URL with `data-state` = loaded / importing / broken
 * (design §F5/§F6) and are draggable (`dragstart` sets the alias on `dataTransfer` — the §F9 affordance; the
 * viewport island is the drop target). Import routes through `assetStore.import(file)`; a rejected/broken
 * asset degrades to the broken state, never a throw. Read-only against the WORLD — no `commands`/`ecs`.
 */
import { createIsland } from "@moku-labs/web/browser";
import type { AssetStore, Assets } from "@nosafesky/ludemic";
import { ASSET_DND_TYPE } from "../lib/asset-dnd";
import { getEditor, onSnapshot } from "../lib/editor-host";

// A cheap signature of the manifest ∪ store projection + the in-flight import count — the gate that avoids
// rebuilding the grid every poll (a load flips a manifest entry; an import adds a store entry with a URL).
const signatureOf = (
  manifest: readonly Assets.AssetEntry[],
  store: readonly AssetStore.StoredAsset[],
  importing: number
): string => {
  const manifestSig = manifest.map(entry => `${entry.alias}:${entry.loaded ? 1 : 0}`).join("|");
  const storeSig = store.map(asset => `${asset.alias}:${asset.url ? 1 : 0}`).join("|");
  return `${manifestSig}#${storeSig}#${importing}`;
};

// A MIME type as a short mono badge — "image/png" → "PNG", "image/svg+xml" → "SVG+XML".
const typeBadge = (mime: string): string => (mime.split("/")[1] ?? mime).toUpperCase();

// A framework-manifest tile: name + (once loaded) its pixel dimensions, dimmed while unloaded. Draggable —
// a manifest alias instantiates through `createSprite(alias)` just like an imported one.
const manifestTile = (entry: Assets.AssetEntry): HTMLLIElement => {
  const tile = document.createElement("li");
  tile.dataset.alias = entry.alias;
  tile.dataset.kind = "manifest";
  tile.dataset.loaded = String(entry.loaded);
  tile.draggable = true;

  const size = entry.loaded ? getEditor().assets.metadata(entry.alias) : undefined;
  let label = entry.alias;
  if (size) {
    tile.dataset.width = String(size.width);
    tile.dataset.height = String(size.height);
    label = `${entry.alias} (${size.width}×${size.height})`;
  }
  tile.textContent = label;
  return tile;
};

// An imported-asset tile: thumbnail (from the store's blob: URL) + name + mono type badge, draggable. A
// URL-less asset — or an <img> that fails to load — degrades to the broken state (hatch + MISSING badge).
const storeTile = (asset: AssetStore.StoredAsset): HTMLLIElement => {
  const tile = document.createElement("li");
  tile.dataset.alias = asset.alias;
  tile.dataset.kind = "imported";
  tile.draggable = true;

  const thumb = document.createElement("div");
  thumb.dataset.thumb = "";
  const name = document.createElement("span");
  name.dataset.name = "";
  name.textContent = asset.name;
  const badge = document.createElement("span");
  badge.dataset.badge = "";
  badge.dataset.mono = "";

  // Mark the tile broken (design §F6): a red-hatched thumbnail + a MISSING badge.
  const markBroken = (): void => {
    tile.dataset.state = "broken";
    badge.textContent = "MISSING";
  };

  if (asset.url) {
    tile.dataset.state = "loaded";
    badge.textContent = typeBadge(asset.mime);
    const img = document.createElement("img");
    img.src = asset.url;
    img.alt = asset.name;
    img.addEventListener("error", markBroken);
    thumb.append(img);
  } else {
    markBroken();
  }

  tile.append(thumb, name, badge);
  return tile;
};

// An optimistic "importing" tile shown while `assetStore.import(file)` is in flight (design §F5). It carries
// no alias (not yet draggable) and is dropped once the import settles — the store rebuild renders the real tile.
const importingTile = (fileName: string): HTMLLIElement => {
  const tile = document.createElement("li");
  tile.dataset.kind = "imported";
  tile.dataset.state = "importing";

  const thumb = document.createElement("div");
  thumb.dataset.thumb = "";
  const name = document.createElement("span");
  name.dataset.name = "";
  name.textContent = fileName;
  const badge = document.createElement("span");
  badge.dataset.badge = "";
  badge.dataset.mono = "";
  badge.textContent = "…";

  tile.append(thumb, name, badge);
  return tile;
};

/**
 * Asset-browser island — the Project panel: enumerate manifest ∪ imported assets, import image files, and
 * make every tile draggable onto the Scene View.
 *
 * On each poll it re-reads `assets.entries()` ∪ `assetStore.entries()` and rebuilds the tiles only when
 * their combined signature changes, so a newly-loaded/imported asset appears within a frame without churning
 * the DOM. The Import button (and the hidden file input the menu-bar can also trigger) routes a chosen image
 * through `assetStore.import(file)`, showing an optimistic importing tile until it settles. A `dragstart` on a
 * tile writes its alias to `dataTransfer` (under {@link ASSET_DND_TYPE}) for the viewport drop. Read-only
 * against the world; the snapshot subscription is released on destroy via `ctx.cleanup`.
 */
export const assetBrowser = createIsland("asset-browser", {
  onMount(ctx) {
    const host = ctx.el as HTMLElement;
    const list = host.querySelector<HTMLElement>("[data-assets]");
    if (!list) return;

    const importButton = host.querySelector<HTMLElement>('[data-action="import"]');
    const fileInput = host.querySelector<HTMLInputElement>('[data-action="import-input"]');

    // In-flight import tiles + the signature gate. `importing.size` rides in the signature so adding/dropping
    // an optimistic tile forces the one render path to rebuild.
    const importing = new Set<HTMLLIElement>();
    let lastSignature = "";

    // The single render path: manifest tiles, then imported tiles, then any in-flight importing tiles.
    const render = (): void => {
      const manifest = getEditor().assets.entries();
      const store = getEditor().assetStore.entries();
      const signature = signatureOf(manifest, store, importing.size);
      if (signature === lastSignature) return;
      lastSignature = signature;
      list.replaceChildren(
        ...manifest.map(entry => manifestTile(entry)),
        ...store.map(asset => storeTile(asset)),
        ...importing
      );
    };

    // Import one file: show an optimistic importing tile, persist via the store, then re-render (the resolved
    // store entry replaces the importing tile; a rejected import just drops it). `import` never throws.
    const runImport = async (file: File): Promise<void> => {
      const tile = importingTile(file.name);
      importing.add(tile);
      render();
      try {
        await getEditor().assetStore.import(file, { name: file.name });
      } finally {
        importing.delete(tile);
        render();
      }
    };

    importButton?.addEventListener("click", () => fileInput?.click());
    fileInput?.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      fileInput.value = ""; // reset so re-importing the same file fires change again
      if (file) void runImport(file);
    });

    // Drag-source affordance (design §F9): write the alias onto dataTransfer; the viewport island drops it.
    list.addEventListener("dragstart", event => {
      const tile = (event.target as Element | null)?.closest<HTMLLIElement>("li[data-alias]");
      const alias = tile?.dataset.alias;
      if (!tile || !alias || !event.dataTransfer) return;
      event.dataTransfer.setData(ASSET_DND_TYPE, alias);
      event.dataTransfer.setData("text/plain", alias);
      event.dataTransfer.effectAllowed = "copy";
      tile.dataset.dragging = "";
    });
    list.addEventListener("dragend", event => {
      const tile = (event.target as Element | null)?.closest<HTMLLIElement>("li[data-alias]");
      if (tile) delete tile.dataset.dragging;
    });

    ctx.cleanup(onSnapshot(render));
  }
});

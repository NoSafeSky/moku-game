/** @file Asset-browser island — assets.entries()/metadata → a browsable asset list. */
import { createIsland } from "@moku-labs/web/browser";
import type { Assets } from "@nosafesky/ludemic";
import { getEditor, onSnapshot } from "../lib/editor-host";

// A cheap signature of the asset projection — the gate that avoids rebuilding the list every poll
// (assets change rarely; only a load flips an entry, so the tiles rebuild only when the signature does).
const signatureOf = (entries: readonly Assets.AssetEntry[]): string =>
  entries.map(entry => `${entry.alias}:${entry.loaded ? 1 : 0}`).join("|");

// Build one asset tile, annotated with pixel dimensions (data-width/height) once the texture is loaded.
const assetTile = (entry: Assets.AssetEntry): HTMLLIElement => {
  const tile = document.createElement("li");
  tile.dataset.alias = entry.alias;
  tile.dataset.loaded = String(entry.loaded);

  // A loaded texture carries its pixel dimensions; an unloaded alias is just its name.
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

/**
 * Asset-browser island — enumerates the runtime's known assets as a read-only tile list.
 *
 * On each poll it reads `assets.entries()` (a cheap projection of the manifest ∪ loaded set) and
 * rebuilds the tiles only when their signature changes, so a newly-loaded asset appears within a frame
 * without churning the DOM every poll. Loaded tiles carry their `metadata()` dimensions as `data-*`.
 * Read-only by contract — the browser never mutates the world (no `commands`/`ecs`). The snapshot
 * subscription is released on destroy via `ctx.cleanup`.
 */
export const assetBrowser = createIsland("asset-browser", {
  onMount(ctx) {
    const host = ctx.el as HTMLElement;
    const list = host.querySelector<HTMLElement>("[data-assets]");
    if (!list) return;

    let lastSignature = "";
    ctx.cleanup(
      onSnapshot(() => {
        const entries = getEditor().assets.entries();
        const signature = signatureOf(entries);
        if (signature === lastSignature) return;
        lastSignature = signature;
        list.replaceChildren(...entries.map(entry => assetTile(entry)));
      })
    );
  }
});

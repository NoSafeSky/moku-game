// @vitest-environment happy-dom

import { mountIsland } from "@moku-labs/web/testing";
import type { AssetStore, Assets } from "@nosafesky/ludemic";
import { afterEach, describe, expect, it, vi } from "vitest";
import { query } from "../helpers/dom";

// A controllable editor-host mock: tiles come from getEditor().assets.entries() (manifest) ∪
// getEditor().assetStore.entries() (imported), re-read on each poll delivered via onSnapshot(); import routes
// through assetStore.import(). vi.hoisted so it precedes the vi.mock factory.
const mocks = vi.hoisted(() => {
  const subscribers = new Set<(snapshot: unknown) => void>();
  const assets = {
    entries: vi.fn<() => Assets.AssetEntry[]>(() => []),
    metadata: vi.fn<(alias: string) => { width: number; height: number } | undefined>(
      () => undefined
    )
  };
  const assetStore = {
    import: vi.fn<() => Promise<AssetStore.StoredAsset>>(async () => ({
      alias: "a",
      name: "a",
      mime: "image/png",
      byteLength: 0,
      url: ""
    })),
    entries: vi.fn<() => AssetStore.StoredAsset[]>(() => [])
  };
  return {
    subscribers,
    assets,
    assetStore,
    getEditor: vi.fn(() => ({ assets, assetStore })),
    onSnapshot: vi.fn((fn: (snapshot: unknown) => void) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    })
  };
});

vi.mock("../../src/lib/editor-host", () => ({
  getEditor: mocks.getEditor,
  onSnapshot: mocks.onSnapshot
}));

const { assetBrowser } = await import("../../src/islands/asset-browser");

const HTML = `
  <header data-panel-header>
    <h2>Assets</h2>
    <button type="button" data-action="import">Import</button>
    <input type="file" accept="image/*" data-action="import-input" hidden />
  </header>
  <ul data-assets></ul>
`;

const snap = (over: Record<string, unknown> = {}) => ({
  epoch: 0,
  entities: [],
  selection: [],
  mode: "edit",
  canUndo: false,
  canRedo: false,
  ...over
});
const push = (snapshot: unknown) => {
  for (const fn of mocks.subscribers) fn(snapshot);
};
const mount = () => mountIsland(assetBrowser, { html: HTML });
const storeAsset = (over: Partial<AssetStore.StoredAsset>): AssetStore.StoredAsset => ({
  alias: "coin-a1",
  name: "coin.png",
  mime: "image/png",
  byteLength: 3,
  url: "blob:coin",
  ...over
});

afterEach(() => {
  mocks.subscribers.clear();
  vi.clearAllMocks();
});

describe("asset-browser island — manifest tiles (P1 behaviour preserved)", () => {
  it("renders one tile per manifest entry, carrying its loaded flag + draggable", () => {
    mocks.assets.entries.mockReturnValue([
      { alias: "hero", loaded: true },
      { alias: "enemy", loaded: false }
    ]);
    const handle = mount();

    push(snap());

    expect(handle.el.querySelectorAll("[data-assets] > li")).toHaveLength(2);
    expect(query(handle.el, "[data-alias='hero']").dataset.loaded).toBe("true");
    expect(query(handle.el, "[data-alias='hero']").draggable).toBe(true);
    expect(query(handle.el, "[data-alias='enemy']").dataset.loaded).toBe("false");
  });

  it("annotates a loaded manifest tile with its metadata dimensions", () => {
    mocks.assets.entries.mockReturnValue([{ alias: "hero", loaded: true }]);
    mocks.assets.metadata.mockReturnValue({ width: 64, height: 32 });
    const handle = mount();

    push(snap());

    const tile = query(handle.el, "[data-alias='hero']");
    expect(tile.dataset.width).toBe("64");
    expect(tile.dataset.height).toBe("32");
    expect(tile.textContent).toContain("64×32");
  });

  it("rebuilds only when the combined signature changes", () => {
    mocks.assets.entries.mockReturnValue([{ alias: "hero", loaded: false }]);
    const handle = mount();
    push(snap({ epoch: 1 }));
    const first = query(handle.el, "[data-alias='hero']");

    push(snap({ epoch: 2 })); // same entries → same signature → no rebuild
    expect(query(handle.el, "[data-alias='hero']")).toBe(first);

    mocks.assets.entries.mockReturnValue([{ alias: "hero", loaded: true }]); // load flips the signature
    push(snap({ epoch: 3 }));
    expect(query(handle.el, "[data-alias='hero']")).not.toBe(first);
    expect(query(handle.el, "[data-alias='hero']").dataset.loaded).toBe("true");
  });
});

describe("asset-browser island — imported tiles (P2)", () => {
  it("merges the manifest and the store, rendering an imported thumbnail + type badge", () => {
    mocks.assets.entries.mockReturnValue([{ alias: "hero", loaded: true }]);
    mocks.assetStore.entries.mockReturnValue([storeAsset({})]);
    const handle = mount();

    push(snap());

    expect(handle.el.querySelectorAll("[data-assets] > li")).toHaveLength(2);
    const coin = query(handle.el, "[data-alias='coin-a1']");
    expect(coin.dataset.kind).toBe("imported");
    expect(coin.dataset.state).toBe("loaded");
    expect(coin.draggable).toBe(true);
    expect(query(coin, "img").getAttribute("src")).toBe("blob:coin");
    expect(query(coin, "[data-badge]").textContent).toBe("PNG");
    expect(query(coin, "[data-name]").textContent).toBe("coin.png");
  });

  it("renders a URL-less store asset — and an <img> that errors — as broken (MISSING)", () => {
    mocks.assetStore.entries.mockReturnValue([
      storeAsset({}),
      storeAsset({ alias: "ghost-b2", name: "ghost.png", url: undefined })
    ]);
    const handle = mount();

    push(snap());

    const ghost = query(handle.el, "[data-alias='ghost-b2']");
    expect(ghost.dataset.state).toBe("broken");
    expect(query(ghost, "[data-badge]").textContent).toBe("MISSING");

    const coin = query(handle.el, "[data-alias='coin-a1']");
    query(coin, "img").dispatchEvent(new Event("error"));
    expect(coin.dataset.state).toBe("broken");
    expect(query(coin, "[data-badge]").textContent).toBe("MISSING");
  });

  it("sets the alias on dataTransfer for a dragged tile, and clears drag-source on dragend (§F9)", () => {
    mocks.assetStore.entries.mockReturnValue([storeAsset({})]);
    const handle = mount();
    push(snap());

    const tile = query(handle.el, "[data-alias='coin-a1']");
    const setData = vi.fn();
    const event = new Event("dragstart", { bubbles: true });
    Object.defineProperty(event, "dataTransfer", {
      value: { setData, effectAllowed: "" } as unknown as DataTransfer
    });
    tile.dispatchEvent(event);

    expect(setData).toHaveBeenCalledWith("application/x-moku-asset", "coin-a1");
    expect(setData).toHaveBeenCalledWith("text/plain", "coin-a1");
    expect(tile.dataset.dragging).toBe("");

    tile.dispatchEvent(new Event("dragend", { bubbles: true }));
    expect(tile.dataset.dragging).toBeUndefined();
  });
});

describe("asset-browser island — import", () => {
  it("routes a chosen file through assetStore.import and shows an optimistic importing tile", async () => {
    // The Promise executor runs synchronously, so `resolveImport` is assigned before the test uses it.
    let resolveImport!: (asset: AssetStore.StoredAsset) => void;
    mocks.assetStore.import.mockReturnValue(
      new Promise<AssetStore.StoredAsset>(resolve => {
        resolveImport = resolve;
      })
    );
    const handle = mount();
    push(snap());

    const input = query<HTMLInputElement>(handle.el, "[data-action='import-input']");
    const file = new File([new Uint8Array([1, 2, 3])], "coin.png", { type: "image/png" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));

    expect(mocks.assetStore.import).toHaveBeenCalledWith(file, { name: "coin.png" });
    const importing = query(handle.el, "[data-assets] li[data-state='importing']");
    expect(query(importing, "[data-name]").textContent).toBe("coin.png");

    // Resolve → the store now holds the asset → the importing tile is replaced by the loaded thumbnail tile.
    mocks.assetStore.entries.mockReturnValue([storeAsset({})]);
    resolveImport(storeAsset({}));
    await Promise.resolve();
    await Promise.resolve();

    expect(handle.el.querySelector("li[data-state='importing']")).toBeNull();
    expect(query(handle.el, "[data-alias='coin-a1']").dataset.state).toBe("loaded");
  });

  it("clicking the Import button opens the hidden file input", () => {
    const handle = mount();
    const input = query<HTMLInputElement>(handle.el, "[data-action='import-input']");
    const click = vi.fn();
    input.click = click;

    query(handle.el, "[data-action='import']").dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );

    expect(click).toHaveBeenCalledTimes(1);
  });
});

describe("asset-browser island — lifecycle", () => {
  it("unsubscribes on unmount", () => {
    const handle = mount();
    expect(mocks.subscribers.size).toBe(1);

    handle.unmount();

    expect(mocks.subscribers.size).toBe(0);
  });
});

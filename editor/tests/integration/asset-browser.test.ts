// @vitest-environment happy-dom

import { mountIsland } from "@moku-labs/web/testing";
import type { Assets } from "@nosafesky/moku-game";
import { afterEach, describe, expect, it, vi } from "vitest";
import { query } from "../helpers/dom";

// A controllable editor-host mock: tiles come from getEditor().assets.entries()/metadata(), re-read on
// each poll delivered via onSnapshot(). vi.hoisted so it precedes the vi.mock factory.
const mocks = vi.hoisted(() => {
  const subscribers = new Set<(snapshot: unknown) => void>();
  const assets = {
    entries: vi.fn<() => Assets.AssetEntry[]>(() => []),
    metadata: vi.fn<(alias: string) => { width: number; height: number } | undefined>(
      () => undefined
    )
  };
  return {
    subscribers,
    assets,
    getEditor: vi.fn(() => ({ assets })),
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

afterEach(() => {
  mocks.subscribers.clear();
  vi.clearAllMocks();
});

describe("asset-browser island", () => {
  it("renders one tile per asset entry, carrying its loaded flag", () => {
    mocks.assets.entries.mockReturnValue([
      { alias: "hero", loaded: true },
      { alias: "enemy", loaded: false }
    ]);
    const handle = mountIsland(assetBrowser, { html: "<ul data-assets></ul>" });

    push(snap());

    expect(handle.el.querySelectorAll("[data-assets] > li")).toHaveLength(2);
    expect(query(handle.el, "[data-alias='hero']").dataset.loaded).toBe("true");
    expect(query(handle.el, "[data-alias='enemy']").dataset.loaded).toBe("false");
  });

  it("annotates a loaded tile with its metadata dimensions", () => {
    mocks.assets.entries.mockReturnValue([{ alias: "hero", loaded: true }]);
    mocks.assets.metadata.mockReturnValue({ width: 64, height: 32 });
    const handle = mountIsland(assetBrowser, { html: "<ul data-assets></ul>" });

    push(snap());

    const tile = query(handle.el, "[data-alias='hero']");
    expect(tile.dataset.width).toBe("64");
    expect(tile.dataset.height).toBe("32");
    expect(tile.textContent).toContain("64×32");
  });

  it("rebuilds only when the entries signature changes", () => {
    mocks.assets.entries.mockReturnValue([{ alias: "hero", loaded: false }]);
    const handle = mountIsland(assetBrowser, { html: "<ul data-assets></ul>" });
    push(snap({ epoch: 1 }));
    const first = query(handle.el, "[data-alias='hero']");

    push(snap({ epoch: 2 })); // same entries → same signature → no rebuild
    expect(query(handle.el, "[data-alias='hero']")).toBe(first);

    mocks.assets.entries.mockReturnValue([{ alias: "hero", loaded: true }]); // load flips the signature
    push(snap({ epoch: 3 }));
    expect(query(handle.el, "[data-alias='hero']")).not.toBe(first);
    expect(query(handle.el, "[data-alias='hero']").dataset.loaded).toBe("true");
  });

  it("unsubscribes on unmount", () => {
    const handle = mountIsland(assetBrowser, { html: "<ul data-assets></ul>" });
    expect(mocks.subscribers.size).toBe(1);

    handle.unmount();

    expect(mocks.subscribers.size).toBe(0);
  });
});

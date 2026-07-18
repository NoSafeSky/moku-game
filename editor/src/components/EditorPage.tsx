/** @file Editor shell — the four-band Slate Precision dock-shell. Static chrome; islands fill each region. */
import { AssetBrowser } from "./AssetBrowser";
import { Hierarchy } from "./Hierarchy";
import { Inspector } from "./Inspector";
import { MenuBar } from "./MenuBar";
import { StatusBar } from "./StatusBar";
import { Toolbar } from "./Toolbar";
import { Viewport } from "./Viewport";

/**
 * The editor's static shell: four fixed bands (menu / toolbar / workspace / status). The workspace is a
 * splitter-divided dock — Hierarchy | (Scene View / Project) | Inspector — whose splitter-adjacent bands
 * are resized by the `workspace` island (clamped `--w-*`/`--h-*` custom properties). Every `[data-island]`
 * container is rendered here so the matching island hydrates it client-side; the container-less
 * `shortcuts` island hydrates a hidden document-level root that carries the global keymap. The `menu-bar`
 * leaves inert static chrome until its wave lands.
 *
 * @returns The full editor shell tree.
 * @example
 * ```tsx
 * route("/").render(() => <EditorPage />);
 * ```
 */
export function EditorPage() {
  return (
    <div data-editor-shell>
      <MenuBar />
      <Toolbar />
      <div data-island="workspace" data-band="workspace">
        <Hierarchy />
        <div data-splitter="hierarchy" aria-hidden="true" />
        <div data-region="center">
          <Viewport />
          <div data-splitter="project" aria-hidden="true" />
          <AssetBrowser />
        </div>
        <div data-splitter="inspector" aria-hidden="true" />
        <Inspector />
      </div>
      <StatusBar />
      <div data-island="shortcuts" hidden />
    </div>
  );
}

/** @file Editor shell — the panel grid. Static chrome; islands fill each region. */
import { AssetBrowser } from "./AssetBrowser";
import { Inspector } from "./Inspector";
import { SceneTree } from "./SceneTree";
import { Toolbar } from "./Toolbar";
import { Viewport } from "./Viewport";

export function EditorPage() {
  return (
    <div data-editor-shell>
      <Toolbar />
      <div data-editor-body>
        <SceneTree />
        <Viewport />
        <Inspector />
      </div>
      <AssetBrowser />
    </div>
  );
}

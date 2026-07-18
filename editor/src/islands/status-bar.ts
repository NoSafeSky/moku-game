/** @file Status-bar island — reflects the snapshot's scene readout (object/selection counts + mode). */
import { createIsland } from "@moku-labs/web/browser";
import type { EditorBridge } from "@nosafesky/ludemic";
import { onSnapshot } from "../lib/editor-host";

// The right-aligned mono readout: object count · selection count · mode. Cheap scalars re-read each poll.
const readoutText = (snapshot: EditorBridge.EditorSnapshot): string => {
  const objects = snapshot.entities.length;
  const selected = snapshot.selection.length;
  return `${objects} objects · ${selected} selected · ${snapshot.mode.toUpperCase()}`;
};

/**
 * Status-bar island — mirrors the editor's scene readout onto the bottom band each poll.
 *
 * The shortcut hint chips are static SSG chrome; this island only fills the right-aligned mono readout
 * (`[data-readout]`) from the snapshot's cheap scalars — object/selection counts and mode — and reflects
 * `data-mode` for styling. Read-only: it never writes the world. The subscription is released on destroy.
 */
export const statusBar = createIsland("status-bar", {
  onMount(ctx) {
    const host = ctx.el as HTMLElement;
    const readout = host.querySelector<HTMLElement>("[data-readout]");
    if (!readout) return;

    ctx.cleanup(
      onSnapshot(snapshot => {
        readout.textContent = readoutText(snapshot);
        host.dataset.mode = snapshot.mode;
      })
    );
  }
});

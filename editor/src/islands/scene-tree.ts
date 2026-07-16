/** @file Scene-tree island — snapshot.entities → selectable rows → bridge.select. */
import { createIsland } from "@moku-labs/web/browser";
import type { Commands, EditorBridge } from "@nosafesky/ludemic";
import { getEditor, onSnapshot } from "../lib/editor-host";

// Build one entity row: "#<id> · <component names>", tagged with data-id for click routing + CSS.
const entityRow = (entity: EditorBridge.EntitySnapshot): HTMLLIElement => {
  const row = document.createElement("li");
  row.dataset.id = String(entity.id);
  const names = entity.components.map(component => component.name).join(", ");
  row.textContent = names ? `#${entity.id} · ${names}` : `#${entity.id}`;
  return row;
};

// Rebuild the whole row list (the epoch-gated heavy write) and refresh the id → EditorId routing map,
// so a row click can reach `bridge.select` with the branded id it was built from (never a re-parsed one).
const rebuildRows = (
  list: HTMLElement,
  entities: readonly EditorBridge.EntitySnapshot[],
  idByRow: Map<string, Commands.EditorId>
): void => {
  idByRow.clear();
  const rows = entities.map(entity => {
    idByRow.set(String(entity.id), entity.id);
    return entityRow(entity);
  });
  list.replaceChildren(...rows);
};

// Reflect the current selection onto the rows (cheap; runs every poll — selection never bumps epoch).
const reflectSelection = (list: HTMLElement, selection: readonly Commands.EditorId[]): void => {
  const selected = new Set(selection.map(String));
  for (const row of list.querySelectorAll<HTMLElement>("[data-id]")) {
    row.toggleAttribute("data-selected", selected.has(row.dataset.id ?? ""));
  }
};

/**
 * Scene-tree island — lists the world's entities as selectable rows and routes clicks to selection.
 *
 * The heavy row rebuild is gated on `snapshot.epoch` (the rows only change on a world write); the
 * cheap selection highlight (`data-selected`) is re-applied every poll because a selection change
 * does not bump the epoch. A row click resolves its `data-id` back to the branded `EditorId` it was
 * built from (via a closure map) and calls `bridge.select` — never `commands`/`ecs`. The snapshot
 * subscription + the delegated click listener are released on destroy via `ctx.cleanup`.
 */
export const sceneTree = createIsland("scene-tree", {
  onMount(ctx) {
    const host = ctx.el as HTMLElement;
    const list = host.querySelector<HTMLElement>("[data-tree]");
    if (!list) return;

    const idByRow = new Map<string, Commands.EditorId>();
    let lastEpoch = -1;

    ctx.cleanup(
      onSnapshot(snapshot => {
        if (snapshot.epoch !== lastEpoch) {
          lastEpoch = snapshot.epoch;
          rebuildRows(list, snapshot.entities, idByRow);
        }
        reflectSelection(list, snapshot.selection);
      })
    );

    const onClick = (event: Event): void => {
      const node = event.target;
      if (!(node instanceof Element)) return;
      const row = node.closest<HTMLElement>("[data-id]");
      if (!row) return;
      const id = idByRow.get(row.dataset.id ?? "");
      if (id !== undefined) getEditor().bridge.select(id);
    };
    host.addEventListener("click", onClick);
    ctx.cleanup(() => host.removeEventListener("click", onClick));
  }
});

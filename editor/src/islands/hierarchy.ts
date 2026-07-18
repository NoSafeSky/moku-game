/**
 * @file hierarchy island — the nested scene tree (replaces `scene-tree`): the drag-reparent surface, the
 * multi-select origin, inline rename, per-row enable eye, context menu, and search — every world mutation
 * routed through `gameApp["editor-bridge"]`, never `commands`/`ecs`.
 *
 * Structure + expand/collapse + flatten come from `@headless-tree/core` via {@link createHierarchyTree};
 * the heavy row rebuild is gated on `snapshot.epoch` (rows only change on a world write) while the cheap
 * selection highlight re-applies every poll. Reparent/reorder use the pure {@link planDrop} mapping so the
 * app only supplies target + drop zone — the framework owns the zero-drift undo (app-spec §2, Risk #3).
 */
import { createIsland } from "@moku-labs/web/browser";
import type { Commands, EditorBridge } from "@nosafesky/ludemic";
import { getEditor, onSnapshot } from "../lib/editor-host";
import {
  computeRowWindow,
  createHierarchyTree,
  planDrop,
  ROW_HEIGHT,
  type VisibleRow,
  zoneFromOffset
} from "../lib/tree-adapter";

/** One entry in the row context menu (design-context D6). */
type MenuItem =
  | { readonly label: string; readonly run: (id: Commands.EditorId) => void }
  | "separator";

// Read a row element's branded editor id.
const idOf = (el: HTMLElement): Commands.EditorId => Number(el.dataset.id) as Commands.EditorId;

// The contiguous id range between two rows in the current flattened order (Shift-click select).
const rangeBetween = (
  order: readonly Commands.EditorId[],
  a: Commands.EditorId,
  b: Commands.EditorId
): Commands.EditorId[] => {
  const indexA = order.indexOf(a);
  const indexB = order.indexOf(b);
  if (indexA === -1 || indexB === -1) return [b];
  const [lo, hi] = indexA <= indexB ? [indexA, indexB] : [indexB, indexA];
  return order.slice(lo, hi + 1);
};

// A fixed-height spacer div reserving scroll height for un-rendered (virtualized) rows.
const spacer = (height: number): HTMLElement => {
  const el = document.createElement("div");
  el.dataset.spacer = "";
  el.style.blockSize = `${height}px`;
  return el;
};

// Build one tree row's DOM: twisty (folders) + eye + name (or rename input) + muted component summary.
const buildRow = (row: VisibleRow, renaming: boolean): HTMLElement => {
  const el = document.createElement("div");
  el.dataset.row = "";
  el.dataset.id = String(row.id);
  el.dataset.enabled = String(row.enabled);
  el.style.setProperty("--level", String(row.level));
  el.draggable = true;

  const twisty = document.createElement("span");
  twisty.dataset.twisty = "";
  if (row.isFolder) {
    if (row.expanded) twisty.dataset.expanded = "";
  } else {
    twisty.dataset.leaf = "";
  }
  el.append(twisty);

  const eye = document.createElement("span");
  eye.dataset.eye = "";
  eye.dataset.on = String(row.enabled);
  el.append(eye);

  if (renaming) {
    const input = document.createElement("input");
    input.dataset.nameInput = "";
    input.value = row.name;
    el.append(input);
    return el;
  }

  const name = document.createElement("span");
  name.dataset.name = "";
  name.textContent = row.name || `#${row.id}`;
  el.append(name);

  if (row.summary) {
    const summary = document.createElement("span");
    summary.dataset.summary = "";
    summary.textContent = row.summary;
    el.append(summary);
  }
  return el;
};

/**
 * Hierarchy island — renders the world's scene graph as a nested, drag-reparentable, multi-selectable
 * tree and routes every edit through the editor bridge.
 *
 * World state (names / parents / order / enabled / selection) is read from the polled snapshot; view-local
 * state (which folders are expanded, the search text, an in-progress rename) lives in the island. A row
 * click selects (plain = replace, Ctrl/Cmd = toggle, Shift = range); the eye toggles `setEnabled`;
 * double-click renames; drag re-parents/reorders via the drop-zone → verb mapping; right-click opens the
 * context menu; the search box filters to matching names. All listeners + the tree engine are released on
 * destroy via `ctx.cleanup`.
 */
export const hierarchy = createIsland("hierarchy", {
  onMount(ctx) {
    const host = ctx.el as HTMLElement;
    const treeElement = host.querySelector<HTMLElement>("[data-tree]");
    const searchElement = host.querySelector<HTMLInputElement>("[data-search]");
    if (!treeElement) return;

    // ── View-local state ──
    let snapshot: EditorBridge.EditorSnapshot | undefined;
    let selection = new Set<Commands.EditorId>();
    let lastClicked: Commands.EditorId | undefined;
    let renamingId: Commands.EditorId | undefined;
    let searchText = "";
    let draggedId: Commands.EditorId | undefined;
    let clipboard: readonly Commands.EditorId[] = [];
    let menuElement: HTMLElement | undefined;

    const bridge = (): EditorBridge.Api => getEditor().bridge;
    const tree = createHierarchyTree({ label: "Scene hierarchy", onRender: () => render() });

    // The rows to show: flat search matches when searching, else the tree's expand-aware rows.
    const currentRows = (): readonly VisibleRow[] => {
      if (!searchText) return tree.rows();
      const query = searchText.toLowerCase();
      return (snapshot?.entities ?? [])
        .filter(entity => (entity.name || `#${entity.id}`).toLowerCase().includes(query))
        .map(entity => ({
          id: entity.id,
          name: entity.name,
          enabled: entity.enabled,
          isFolder: entity.children.length > 0,
          summary: entity.components.map(component => component.name).join(" · "),
          level: 0,
          expanded: false
        }));
    };

    const findRow = (id: Commands.EditorId): VisibleRow | undefined =>
      currentRows().find(row => row.id === id);

    // Re-apply the selection highlight to the mounted rows — cheap, runs every poll (selection never bumps epoch).
    const reflectSelection = (): void => {
      for (const rowElement of treeElement.querySelectorAll<HTMLElement>("[data-row]")) {
        rowElement.toggleAttribute("data-selected", selection.has(idOf(rowElement)));
      }
    };

    // Focus + select the inline rename input after a render that opened one.
    const focusRenameInput = (): void => {
      const input = treeElement.querySelector<HTMLInputElement>("[data-name-input]");
      if (input) {
        input.focus();
        input.select();
      }
    };

    // Rebuild the visible rows (the epoch-gated heavy write): window the flat list, then materialize the slice.
    const render = (): void => {
      const rows = currentRows();
      const window = computeRowWindow(
        rows.length,
        treeElement.scrollTop,
        treeElement.clientHeight,
        ROW_HEIGHT
      );

      const fragment = document.createDocumentFragment();
      if (window.padTop > 0) fragment.append(spacer(window.padTop));
      for (const index of window.indices) {
        const row = rows[index];
        if (row) fragment.append(buildRow(row, renamingId === row.id));
      }
      if (window.padBottom > 0) fragment.append(spacer(window.padBottom));

      treeElement.replaceChildren(fragment);
      treeElement.toggleAttribute("data-empty", rows.length === 0);
      reflectSelection();
      focusRenameInput();
    };

    // Mount the tree engine now that `render` (its onRender target) exists; the first poll fills it.
    tree.mount(treeElement);

    // ── Selection ──
    const selectRow = (id: Commands.EditorId, event: MouseEvent): void => {
      const order = currentRows().map(row => row.id);
      if (event.shiftKey && lastClicked !== undefined) {
        bridge().select(...rangeBetween(order, lastClicked, id));
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        const next = new Set(selection);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        bridge().select(...next);
        lastClicked = id;
        return;
      }
      bridge().select(id);
      lastClicked = id;
    };

    // ── Inline rename ──
    const startRename = (id: Commands.EditorId): void => {
      renamingId = id;
      render();
    };
    const commitRename = (id: Commands.EditorId, value: string): void => {
      renamingId = undefined;
      const trimmed = value.trim();
      if (trimmed) bridge().rename(id, trimmed);
      render();
    };
    const cancelRename = (): void => {
      renamingId = undefined;
      render();
    };

    // ── Context menu ──
    const closeMenu = (): void => {
      menuElement?.remove();
      menuElement = undefined;
    };

    const MENU: readonly MenuItem[] = [
      { label: "Rename", run: startRename },
      { label: "Duplicate", run: id => bridge().duplicate(id) },
      { label: "Delete", run: id => bridge().delete(id) },
      "separator",
      { label: "Create Empty", run: () => bridge().create() },
      { label: "Create Child", run: id => bridge().create({ parent: id }) },
      "separator",
      {
        label: "Copy",
        run: id => {
          clipboard = selection.size > 0 ? [...selection] : [id];
        }
      },
      {
        label: "Paste",
        run: () => {
          if (clipboard.length > 0) bridge().duplicate(...clipboard);
        }
      }
    ];

    const openMenu = (x: number, y: number, id: Commands.EditorId): void => {
      closeMenu();
      const menu = document.createElement("div");
      menu.dataset.contextMenu = "";
      menu.style.left = `${x}px`;
      menu.style.top = `${y}px`;

      for (const item of MENU) {
        if (item === "separator") {
          const separator = document.createElement("div");
          separator.dataset.separator = "";
          menu.append(separator);
          continue;
        }
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = item.label;
        if (item.label === "Paste" && clipboard.length === 0) button.disabled = true;
        button.addEventListener("click", () => {
          item.run(id);
          closeMenu();
        });
        menu.append(button);
      }

      host.append(menu);
      menuElement = menu;
    };

    // ── Drag reparent/reorder ──
    const clearDropZones = (): void => {
      for (const rowElement of treeElement.querySelectorAll<HTMLElement>("[data-drop-zone]")) {
        delete rowElement.dataset.dropZone;
      }
    };
    const endDrag = (): void => {
      draggedId = undefined;
      clearDropZones();
      for (const rowElement of treeElement.querySelectorAll<HTMLElement>("[data-dragging]")) {
        delete rowElement.dataset.dragging;
      }
    };

    // Where a drag currently sits over a row (pointer band → before/inside/after).
    const zoneAt = (
      rowElement: HTMLElement,
      clientY: number
    ): ReturnType<typeof zoneFromOffset> => {
      const rect = rowElement.getBoundingClientRect();
      const canNest = findRow(idOf(rowElement))?.isFolder ?? false;
      return zoneFromOffset(clientY - rect.top, rect.height, canNest);
    };

    const applyDrop = (
      target: Commands.EditorId,
      zone: ReturnType<typeof zoneFromOffset>
    ): void => {
      if (draggedId === undefined || !snapshot) return;
      const plan = planDrop({ snapshot, dragged: draggedId, target, zone });
      if (!plan) return;

      if (plan.verb === "reorder") {
        bridge().reorder(plan.id, plan.before, plan.after);
        return;
      }
      // exactOptionalPropertyTypes: only set the anchors that exist.
      const opts: { before?: Commands.EditorId; after?: Commands.EditorId } = {};
      if (plan.before !== undefined) opts.before = plan.before;
      if (plan.after !== undefined) opts.after = plan.after;
      bridge().reparent(plan.id, plan.newParent, opts);
    };

    // ── Delegated listeners on the tree container ──
    const onClick = (event: MouseEvent): void => {
      if (menuElement) closeMenu();
      const target = event.target;
      if (!(target instanceof Element)) return;
      const rowElement = target.closest<HTMLElement>("[data-row]");
      if (!rowElement) return;
      const id = idOf(rowElement);

      const twisty = target.closest<HTMLElement>("[data-twisty]");
      if (twisty && !("leaf" in twisty.dataset)) {
        tree.toggleExpand(id);
        return;
      }
      if (target.closest("[data-eye]")) {
        bridge().setEnabled(id, !(findRow(id)?.enabled ?? true));
        return;
      }
      selectRow(id, event);
    };

    const onDblClick = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest("[data-eye],[data-twisty]")) return;
      const rowElement = target.closest<HTMLElement>("[data-row]");
      if (rowElement) startRename(idOf(rowElement));
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || !("nameInput" in input.dataset)) return;
      const rowElement = input.closest<HTMLElement>("[data-row]");
      if (!rowElement) return;
      if (event.key === "Enter") {
        event.preventDefault();
        commitRename(idOf(rowElement), input.value);
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancelRename();
      }
    };

    const onFocusOut = (event: FocusEvent): void => {
      const input = event.target;
      if (
        input instanceof HTMLInputElement &&
        "nameInput" in input.dataset &&
        renamingId !== undefined
      ) {
        const rowElement = input.closest<HTMLElement>("[data-row]");
        if (rowElement) commitRename(idOf(rowElement), input.value);
      }
    };

    const onContextMenu = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const rowElement = target.closest<HTMLElement>("[data-row]");
      if (!rowElement) return;
      event.preventDefault();
      const id = idOf(rowElement);
      if (!selection.has(id)) {
        selection = new Set([id]);
        bridge().select(id);
        lastClicked = id;
        reflectSelection();
      }
      openMenu(event.clientX, event.clientY, id);
    };

    const onDragStart = (event: DragEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const rowElement = target.closest<HTMLElement>("[data-row]");
      if (!rowElement) return;
      draggedId = idOf(rowElement);
      rowElement.dataset.dragging = "";
      event.dataTransfer?.setData("text/plain", String(draggedId));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    };

    const onDragOver = (event: DragEvent): void => {
      if (draggedId === undefined) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const rowElement = target.closest<HTMLElement>("[data-row]");
      if (!rowElement) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      clearDropZones();
      rowElement.dataset.dropZone = zoneAt(rowElement, event.clientY);
    };

    const onDrop = (event: DragEvent): void => {
      const target = event.target;
      const rowElement =
        target instanceof Element ? target.closest<HTMLElement>("[data-row]") : undefined;
      if (rowElement && draggedId !== undefined) {
        event.preventDefault();
        applyDrop(idOf(rowElement), zoneAt(rowElement, event.clientY));
      }
      endDrag();
    };

    treeElement.addEventListener("click", onClick);
    treeElement.addEventListener("dblclick", onDblClick);
    treeElement.addEventListener("keydown", onKeyDown);
    treeElement.addEventListener("focusout", onFocusOut);
    treeElement.addEventListener("contextmenu", onContextMenu);
    treeElement.addEventListener("dragstart", onDragStart);
    treeElement.addEventListener("dragover", onDragOver);
    treeElement.addEventListener("dragleave", clearDropZones);
    treeElement.addEventListener("drop", onDrop);
    treeElement.addEventListener("dragend", endDrag);
    treeElement.addEventListener("scroll", render);

    // ── Header action buttons (bubble up from the panel header, outside the tree) ──
    const onHeaderClick = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLElement>("[data-action]");
      if (!button) return;
      const action = button.dataset.action;
      if (action === "create") bridge().create();
      else if (action === "duplicate" && selection.size > 0) bridge().duplicate(...selection);
      else if (action === "delete" && selection.size > 0) bridge().delete(...selection);
    };
    host.addEventListener("click", onHeaderClick);

    // ── Search ──
    const onSearch = (): void => {
      searchText = searchElement?.value.trim() ?? "";
      render();
    };
    searchElement?.addEventListener("input", onSearch);

    // ── Close the context menu on an outside click / Escape ──
    const onDocumentPointerDown = (event: Event): void => {
      if (menuElement && event.target instanceof Node && !menuElement.contains(event.target)) {
        closeMenu();
      }
    };
    const onDocumentKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") closeMenu();
    };
    document.addEventListener("pointerdown", onDocumentPointerDown);
    document.addEventListener("keydown", onDocumentKeyDown);

    // ── The one snapshot subscription: epoch-gated rebuild + per-poll selection reflect ──
    ctx.cleanup(
      onSnapshot(next => {
        const epochChanged = !snapshot || next.epoch !== snapshot.epoch;
        snapshot = next;
        selection = new Set(next.selection);
        if (epochChanged) tree.sync(next);
        reflectSelection();
      })
    );

    ctx.cleanup(() => {
      closeMenu();
      tree.destroy();
      host.removeEventListener("click", onHeaderClick);
      searchElement?.removeEventListener("input", onSearch);
      document.removeEventListener("pointerdown", onDocumentPointerDown);
      document.removeEventListener("keydown", onDocumentKeyDown);
    });
  }
});

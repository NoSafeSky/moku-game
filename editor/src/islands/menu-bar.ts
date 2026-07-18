/**
 * @file menu-bar island — the GameObject / Edit / Window dropdown menus (Assets is present-but-disabled).
 *
 * Each menu is a second surface onto existing bridge verbs (design-context §4): GameObject creates /
 * duplicates / deletes, Edit drives undo/redo/duplicate/delete/select-all, and Window toggles panel
 * visibility. Menus open on click, hover-switch between open top-levels, and close on outside-click /
 * Escape — one at a time (design-context §4). The right-aligned scene readout reflects an amber dirty dot
 * once the world has been edited. Every WORLD write routes through `gameApp["editor-bridge"]` — never
 * `commands`/`ecs`; panel visibility is a pure view toggle on the shell DOM.
 */
import { createIsland } from "@moku-labs/web/browser";
import type { Commands, EditorBridge } from "@nosafesky/ludemic";
import { getEditor, onSnapshot } from "../lib/editor-host";

/** The scene-name readout — cosmetic (the snapshot carries no scene name in Phase 1). */
const SCENE_NAME = "Level_01_Rooftops";

/** One dropdown row: a runnable item (optionally disabled / checked) or a rule. */
type MenuItem =
  | {
      readonly label: string;
      readonly run: () => void;
      readonly disabled?: boolean;
      readonly checked?: boolean;
    }
  | "separator";

// The first enumerable asset alias (Create Sprite target), or `undefined` when none are loaded.
const firstAsset = (): string | undefined => getEditor().assets.entries()[0]?.alias;

// A Window-menu row that toggles one panel's visibility (a pure view toggle on the shell DOM).
const panelToggle = (label: string, selector: string): MenuItem => {
  const target = document.querySelector<HTMLElement>(selector);
  const visible = target ? target.style.display !== "none" : true;
  return {
    label,
    checked: visible,
    run: () => {
      if (target) target.style.display = visible ? "none" : "";
    }
  };
};

/**
 * Menu-bar island — wires the top-level dropdown menus to the bridge and reflects the scene readout.
 *
 * The menu definitions are rebuilt from the latest snapshot each time a menu opens, so disabled/checked
 * states (canUndo/canRedo, an empty selection, panel visibility) are always current. The delegated
 * listeners open a menu on click, hover-switch while one is open, and dispatch a row's verb on click;
 * outside-click / Escape close the open menu. The one snapshot subscription reflects the dirty dot. Every
 * listener is released on destroy via `ctx.cleanup`.
 */
export const menuBar = createIsland("menu-bar", {
  onMount(ctx) {
    const host = ctx.el as HTMLElement;

    // ── View-local state ──
    let snapshot: EditorBridge.EditorSnapshot | undefined;
    let cleanEpoch: number | undefined; // epoch at load — the scene is dirty once it advances past this
    let openName: string | undefined;
    let dropdown: HTMLElement | undefined;

    const bridge = (): EditorBridge.Api => getEditor().bridge;
    const selection = (): readonly Commands.EditorId[] => snapshot?.selection ?? [];

    // The rows for one top-level menu, rebuilt from the current snapshot (so disabled states are live).
    const buildMenu = (name: string): readonly MenuItem[] => {
      const ids = selection();
      const hasSelection = ids.length > 0;
      const parent = ids[0];

      if (name === "gameobject") {
        const alias = firstAsset();
        return [
          { label: "Create Empty", run: () => bridge().create() },
          {
            label: "Create Child",
            run: () => {
              if (parent !== undefined) bridge().create({ parent });
            },
            disabled: !hasSelection
          },
          { label: "Create Shape", run: () => bridge().createShape("rect") },
          {
            label: "Create Sprite",
            run: () => {
              if (alias !== undefined) bridge().createSprite(alias);
            },
            disabled: alias === undefined
          },
          "separator",
          { label: "Duplicate", run: () => bridge().duplicate(...ids), disabled: !hasSelection },
          { label: "Delete", run: () => bridge().delete(...ids), disabled: !hasSelection }
        ];
      }
      if (name === "edit") {
        return [
          { label: "Undo", run: () => bridge().undo(), disabled: !snapshot?.canUndo },
          { label: "Redo", run: () => bridge().redo(), disabled: !snapshot?.canRedo },
          "separator",
          { label: "Duplicate", run: () => bridge().duplicate(...ids), disabled: !hasSelection },
          { label: "Delete", run: () => bridge().delete(...ids), disabled: !hasSelection },
          "separator",
          {
            label: "Select All",
            run: () => bridge().select(...(snapshot?.entities ?? []).map(entity => entity.id))
          }
        ];
      }
      if (name === "window") {
        return [
          panelToggle("Hierarchy", '[data-island="hierarchy"]'),
          panelToggle("Inspector", '[data-island="inspector"]'),
          panelToggle("Project", '[data-island="asset-browser"]')
        ];
      }
      return [];
    };

    // ── Dropdown open/close ──
    const closeMenu = (): void => {
      dropdown?.remove();
      dropdown = undefined;
      if (openName) {
        const trigger = host.querySelector(`[data-menu="${openName}"]`);
        trigger?.removeAttribute("data-open");
        trigger?.setAttribute("aria-expanded", "false");
      }
      openName = undefined;
    };

    const appendRow = (menu: HTMLElement, item: MenuItem): void => {
      if (item === "separator") {
        menu.append(document.createElement("hr"));
        return;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.item = "";
      button.disabled = item.disabled === true;
      if (item.checked) button.dataset.checked = "";

      const check = document.createElement("span");
      check.dataset.check = "";
      check.textContent = item.checked ? "✓" : "";
      const label = document.createElement("span");
      label.textContent = item.label;
      button.append(check, label);

      if (!button.disabled) {
        button.addEventListener("click", () => {
          item.run();
          closeMenu();
        });
      }
      menu.append(button);
    };

    const openMenu = (name: string): void => {
      closeMenu();
      const button = host.querySelector<HTMLElement>(`[data-menu="${name}"]`);
      if (!button || (button as HTMLButtonElement).disabled) return;
      button.dataset.open = "";
      button.setAttribute("aria-expanded", "true");

      const menu = document.createElement("div");
      menu.dataset.dropdown = "";
      const rect = button.getBoundingClientRect();
      menu.style.left = `${rect.left}px`;
      menu.style.top = `${rect.bottom}px`;
      for (const item of buildMenu(name)) appendRow(menu, item);

      host.append(menu);
      dropdown = menu;
      openName = name;
    };

    // ── Delegated listeners ──
    const onClick = (event: Event): void => {
      const node = event.target;
      if (!(node instanceof Element)) return;
      const button = node.closest<HTMLElement>("[data-menu]");
      if (!button || (button as HTMLButtonElement).disabled) return;
      const name = button.dataset.menu;
      if (!name) return;
      if (openName === name) closeMenu();
      else openMenu(name);
    };

    // Hover-switch: while one menu is open, hovering another open-able top-level switches to it.
    const onPointerOver = (event: Event): void => {
      if (!openName) return;
      const node = event.target;
      if (!(node instanceof Element)) return;
      const button = node.closest<HTMLElement>("[data-menu]");
      if (!button || (button as HTMLButtonElement).disabled) return;
      const name = button.dataset.menu;
      if (name && name !== openName) openMenu(name);
    };

    host.addEventListener("click", onClick);
    host.addEventListener("pointerover", onPointerOver);

    const onDocumentPointerDown = (event: Event): void => {
      if (dropdown && event.target instanceof Node && !host.contains(event.target)) closeMenu();
    };
    const onDocumentKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") closeMenu();
    };
    document.addEventListener("pointerdown", onDocumentPointerDown);
    document.addEventListener("keydown", onDocumentKeyDown);

    // ── Scene readout ──
    const sceneName = host.querySelector<HTMLElement>("[data-scene-name]");
    if (sceneName) sceneName.textContent = SCENE_NAME;
    const dirtyDot = host.querySelector<HTMLElement>("[data-dirty]");

    ctx.cleanup(
      onSnapshot(next => {
        snapshot = next;
        // The scene is "clean" at the first epoch we see (post-seed); any later write marks it dirty.
        if (cleanEpoch === undefined) cleanEpoch = next.epoch;
        dirtyDot?.toggleAttribute("hidden", next.epoch === cleanEpoch);
      })
    );

    ctx.cleanup(() => {
      closeMenu();
      host.removeEventListener("click", onClick);
      host.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerdown", onDocumentPointerDown);
      document.removeEventListener("keydown", onDocumentKeyDown);
    });
  }
});

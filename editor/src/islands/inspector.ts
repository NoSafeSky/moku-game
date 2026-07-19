/**
 * @file Inspector island — the selection's editable component stack.
 *
 * On each `(epoch, selection)` change it rebuilds `[data-body]` into one of three states: the no-selection
 * empty state (F7), a single object's editable stack (object header + collapsible component sections +
 * Add-Component), or the multi-object view (F13/F14 — "N Objects Selected", shared components only,
 * divergent fields shown as a non-editable "—"). Every WORLD write routes through `gameApp["editor-bridge"]`
 * — never `commands`/`ecs`: field edits via `setField`, the object header via `rename`/`setEnabled`, the
 * kebab menu via `removeComponent` (+ a Reset burst of `setField`s from the catalog defaults), and the
 * Add-Component picker via `addComponent` sourced from `listComponents()`. Reference fields open the
 * `field-controls` picker (D9) with candidates drawn from the snapshot (entities) or `assets.entries()`.
 */
import { createIsland } from "@moku-labs/web/browser";
import type { Commands, EditorBridge, Reflection } from "@nosafesky/ludemic";
import { getEditor, onSnapshot } from "../lib/editor-host";
import {
  mergeAssetCandidates,
  openReferencePicker,
  type ReferenceCandidate,
  readControl,
  renderControl
} from "../lib/field-controls";

/** The stable editor id the inspector addresses for selection + writes (a branded number). */
type EditorId = Commands.EditorId;

/** The write-routing binding stamped per control during a rebuild: which entities + component + field it edits. */
type FieldBinding = {
  readonly ids: readonly EditorId[];
  readonly component: string;
  readonly descriptor: Reflection.FieldDescriptor;
};

/** One resolved field cell: its value, and whether it diverges across a multi-selection (→ "—"). */
type FieldCell = { readonly mixed: boolean; readonly value: unknown };

// The kebab-menu items deferred past P1 — present but inert, per design-context D7.
const KEBAB_STUBS = ["Copy Component", "Paste Component Values", "Move Up", "Move Down"] as const;

// Read one field's current value out of a component's (unknown, frozen) value object.
const fieldValue = (componentValue: unknown, key: string): unknown => {
  if (typeof componentValue === "object" && componentValue !== null) {
    return (componentValue as Record<string, unknown>)[key];
  }
  return undefined;
};

// The live value of a named component on an entity (`undefined` when the entity lacks it).
const componentValueOf = (entity: EditorBridge.EntitySnapshot, name: string): unknown =>
  entity.components.find(component => component.name === name)?.value;

// Whether every value is structurally equal to the first — the divergent-field test for multi-select.
const allEqual = (values: readonly unknown[]): boolean =>
  values.every(value => JSON.stringify(value) === JSON.stringify(values[0]));

// The component names present on EVERY selected entity (the multi-object shared set, F14).
const sharedComponentNames = (
  entities: readonly EditorBridge.EntitySnapshot[]
): readonly string[] => {
  const [first, ...rest] = entities;
  if (!first) return [];
  return first.components
    .map(component => component.name)
    .filter(name => rest.every(entity => entity.components.some(c => c.name === name)));
};

// A plain element with a data-* flag set (identity as data-*, never a class).
const flagged = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  flag: string
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  element.dataset[flag] = "";
  return element;
};

/**
 * Inspector island — renders the selection's editors and routes every edit through the bridge.
 *
 * Heavy rebuilds are gated on `(epoch, selectionKey)` (a selection change does not bump the epoch, so
 * both are tracked); view-local state (which sections are collapsed, an open popup) lives in the island.
 * The delegated `change` reads a control with `readControl` and writes each bound id via `bridge.setField`;
 * `click` drives collapse toggles, the kebab menu, the reference picker, and the Add-Component picker.
 * All popups close on outside-click / Escape; every listener is released on destroy via `ctx.cleanup`.
 */
export const inspector = createIsland("inspector", {
  onMount(ctx) {
    const host = ctx.el as HTMLElement;
    const body = host.querySelector<HTMLElement>("[data-body]");
    if (!body) return;

    // ── View-local state ──
    const registry = new Map<HTMLElement, FieldBinding>();
    const collapsed = new Set<string>();
    let snapshot: EditorBridge.EditorSnapshot | undefined;
    let singleId: EditorId | undefined;
    let lastEpoch = -1;
    let lastSelectionKey = "";
    let popupElement: HTMLElement | undefined;
    let closePopup: (() => void) | undefined;

    const bridge = (): EditorBridge.Api => getEditor().bridge;
    const byId = (id: EditorId): EditorBridge.EntitySnapshot | undefined =>
      snapshot?.entities.find(entity => entity.id === id);

    // ── Popups (kebab menu D7 / Add-Component picker D8 close together; the reference picker D9
    //    self-manages its own listeners via openReferencePicker) ──
    const closePopups = (): void => {
      closePopup?.();
      closePopup = undefined;
      popupElement = undefined;
    };

    // ── Field control + write routing ──

    // Route one control's edited value to every bound id; flag the control on the first rejected write.
    const applyField = (control: HTMLElement, binding: FieldBinding): void => {
      delete control.dataset.invalid;
      const value = readControl(control, binding.descriptor);
      let firstError: string | undefined;
      for (const id of binding.ids) {
        const result = bridge().setField(id, binding.component, binding.descriptor.key, value);
        if (!result.ok && firstError === undefined) firstError = result.error;
      }
      if (firstError !== undefined) {
        control.dataset.invalid = "";
        control.title = firstError;
      }
    };

    // Set a reference control's target (from the D9 picker) and re-fire it through the write path.
    const setReference = (
      control: HTMLElement,
      isEntity: boolean,
      raw: string | undefined
    ): void => {
      control.dataset.refValue = raw ?? "";
      const nameElement = control.querySelector<HTMLElement>("[data-ref-name]");
      if (nameElement) {
        if (raw === undefined) nameElement.textContent = "None";
        else if (isEntity)
          nameElement.textContent = byId(Number(raw) as EditorId)?.name || `#${raw}`;
        else nameElement.textContent = raw;
      }
      control.dispatchEvent(new Event("change", { bubbles: true }));
    };

    // Build one label + control pair into `children`, registering the control's write binding. A field
    // that diverges across a multi-selection renders as the non-editable "—" instead of a control.
    const pushFieldRow = (
      children: Node[],
      ids: readonly EditorId[],
      component: string,
      descriptor: Reflection.FieldDescriptor,
      cell: FieldCell
    ): void => {
      const label = flagged("label", "fieldLabel");
      label.textContent = descriptor.label;
      children.push(label);

      if (cell.mixed) {
        const mixed = flagged("span", "mixed");
        mixed.textContent = "—";
        children.push(mixed);
        return;
      }

      const control = renderControl(descriptor, cell.value);
      registry.set(control, { ids, component, descriptor });

      // Resolve an entity-ref chip's display name from the snapshot (the raw value is an id).
      if (descriptor.kind === "entity-ref" && cell.value !== undefined && cell.value !== null) {
        const nameElement = control.querySelector<HTMLElement>("[data-ref-name]");
        const referenced = byId(Number(cell.value) as EditorId);
        if (nameElement && referenced)
          nameElement.textContent = referenced.name || `#${referenced.id}`;
      }
      children.push(control);
    };

    // ── Component section (a bordered, collapsible block) ──
    const buildSection = (
      ids: readonly EditorId[],
      name: string,
      fields: readonly Reflection.FieldDescriptor[],
      cellOf: (key: string) => FieldCell
    ): HTMLElement => {
      const section = flagged("div", "section");
      section.dataset.component = name;
      if (collapsed.has(name)) section.dataset.collapsed = "";

      const header = flagged("div", "sectionHeader");
      header.append(flagged("span", "twisty"));
      const nameElement = flagged("span", "sectionName");
      nameElement.textContent = name;
      header.append(nameElement);
      const kebab = flagged("button", "kebab");
      kebab.textContent = "⋯";
      kebab.dataset.component = name;
      header.append(kebab);
      section.append(header);

      const sectionBody = flagged("div", "sectionBody");
      const rows: Node[] = [];
      for (const descriptor of fields) {
        pushFieldRow(rows, ids, name, descriptor, cellOf(descriptor.key));
      }
      sectionBody.replaceChildren(...rows);
      section.append(sectionBody);
      return section;
    };

    // ── The three body states ──

    const renderEmpty = (): void => {
      singleId = undefined;
      const box = flagged("div", "emptyState");
      const icon = flagged("span", "emptyIcon");
      icon.textContent = "◎";
      const text = document.createElement("span");
      text.textContent = "No object selected";
      box.append(icon, text);
      body.replaceChildren(box);
    };

    const buildObjectHeader = (entity: EditorBridge.EntitySnapshot): HTMLElement => {
      const header = flagged("div", "objectHeader");

      const enable = document.createElement("input");
      enable.type = "checkbox";
      enable.dataset.enable = "";
      enable.checked = entity.enabled;
      header.append(enable);

      const name = document.createElement("input");
      name.type = "text";
      name.dataset.name = "";
      name.value = entity.name;
      header.append(name);

      const tag = flagged("span", "tag");
      tag.textContent = `#${entity.id}`;
      header.append(tag);
      return header;
    };

    const renderSingle = (entity: EditorBridge.EntitySnapshot): void => {
      singleId = entity.id;
      const children: Node[] = [buildObjectHeader(entity)];

      for (const component of entity.components) {
        children.push(
          buildSection([entity.id], component.name, component.fields, key => ({
            mixed: false,
            value: fieldValue(component.value, key)
          }))
        );
      }

      const add = flagged("button", "addComponent");
      add.textContent = "Add Component";
      children.push(add);
      body.replaceChildren(...children);
    };

    const renderMulti = (entities: readonly EditorBridge.EntitySnapshot[]): void => {
      singleId = undefined;
      const ids = entities.map(entity => entity.id);
      const header = flagged("div", "multiHeader");
      header.textContent = `${entities.length} Objects Selected`;
      const children: Node[] = [header];

      const [first] = entities;
      for (const name of sharedComponentNames(entities)) {
        const fields = first?.components.find(c => c.name === name)?.fields ?? [];
        children.push(
          buildSection(ids, name, fields, key => {
            const values = entities.map(entity => fieldValue(componentValueOf(entity, name), key));
            return { mixed: !allEqual(values), value: values[0] };
          })
        );
      }
      body.replaceChildren(...children);
    };

    const rebuild = (): void => {
      closePopups();
      registry.clear();
      const selected = (snapshot?.selection ?? [])
        .map(id => byId(id))
        .filter((entity): entity is EditorBridge.EntitySnapshot => entity !== undefined);

      if (selected.length === 0) renderEmpty();
      else if (selected.length === 1 && selected[0]) renderSingle(selected[0]);
      else renderMulti(selected);
    };

    // ── Kebab menu (D7 — Reset + Remove Component; the rest are inert stubs) ──
    const resetComponent = (ids: readonly EditorId[], component: string): void => {
      const entry = bridge()
        .listComponents()
        .find(candidate => candidate.name === component);
      if (!entry) return;
      for (const id of ids) {
        for (const [key, value] of Object.entries(entry.defaults)) {
          bridge().setField(id, component, key, value);
        }
      }
    };

    const menuButton = (label: string, run: () => void, disabled: boolean): HTMLButtonElement => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.disabled = disabled;
      if (!disabled) {
        button.addEventListener("click", () => {
          run();
          closePopups();
        });
      }
      return button;
    };

    const openKebab = (anchor: HTMLElement, ids: readonly EditorId[], component: string): void => {
      closePopups();
      const entry = bridge()
        .listComponents()
        .find(candidate => candidate.name === component);

      const menu = flagged("div", "kebabMenu");
      const rect = anchor.getBoundingClientRect();
      menu.style.left = `${rect.left}px`;
      menu.style.top = `${rect.bottom}px`;

      menu.append(menuButton("Reset", () => resetComponent(ids, component), !entry));
      menu.append(
        // Transform is implicit on every object (catalog `addable: false`) — never removable.
        menuButton(
          "Remove Component",
          () => {
            for (const id of ids) bridge().removeComponent(id, component);
          },
          entry?.addable === false
        )
      );
      menu.append(flagged("div", "separator"));
      for (const stub of KEBAB_STUBS) menu.append(menuButton(stub, () => {}, true));

      host.append(menu);
      popupElement = menu;
      closePopup = () => menu.remove();
    };

    // ── Add-Component picker (D8 — categorized, live-filtered, `addable` + not-already-present) ──
    const openAddPicker = (anchor: HTMLElement, entity: EditorBridge.EntitySnapshot): void => {
      closePopups();
      const present = new Set(entity.components.map(component => component.name));
      const addable = bridge()
        .listComponents()
        .filter(entry => entry.addable && !present.has(entry.name));

      const picker = flagged("div", "addPicker");
      const rect = anchor.getBoundingClientRect();
      picker.style.left = `${rect.left}px`;
      picker.style.top = `${rect.top}px`;

      const search = document.createElement("input");
      search.type = "text";
      search.dataset.addSearch = "";
      search.placeholder = "Search components…";
      picker.append(search);

      const list = flagged("div", "addList");
      picker.append(list);

      // Materialize the (optionally filtered) catalog grouped by category, newest filter each keystroke.
      const renderList = (query: string): void => {
        const rows: Node[] = [];
        let lastCategory = "";
        for (const entry of addable) {
          if (query && !entry.name.toLowerCase().includes(query)) continue;
          if (entry.category !== lastCategory) {
            lastCategory = entry.category;
            const heading = flagged("div", "category");
            heading.textContent = entry.category;
            rows.push(heading);
          }
          const option = document.createElement("button");
          option.type = "button";
          option.dataset.addOption = "";
          option.dataset.component = entry.name;
          option.textContent = entry.name;
          option.addEventListener("click", () => {
            bridge().addComponent(entity.id, entry.name);
            closePopups();
          });
          rows.push(option);
        }
        list.replaceChildren(...rows);
      };

      renderList("");
      search.addEventListener("input", () => renderList(search.value.trim().toLowerCase()));

      host.append(picker);
      popupElement = picker;
      closePopup = () => picker.remove();
      search.focus();
    };

    // ── Reference picker (D9 — via field-controls; candidates from the snapshot / assets) ──
    const showReferencePicker = (pickButton: HTMLElement): void => {
      const control = pickButton.closest<HTMLElement>("[data-field-key]");
      if (!control || !snapshot) return;
      const binding = registry.get(control);
      if (!binding) return;

      const isEntity = binding.descriptor.kind === "entity-ref";
      // An asset-ref lists the manifest ∪ imported-store aliases (P2), deduped by alias so an
      // imported sprite is selectable in a `SpriteRenderer.sprite` field (and then resolves + renders).
      const editor = getEditor();
      const candidates: readonly ReferenceCandidate[] = isEntity
        ? snapshot.entities
            .filter(entity => !binding.ids.includes(entity.id))
            .map(entity => ({ value: String(entity.id), label: entity.name || `#${entity.id}` }))
        : mergeAssetCandidates(
            editor.assets.entries().map(entry => entry.alias),
            editor.assetStore.entries().map(entry => entry.alias)
          );

      closePopups();
      closePopup = openReferencePicker({
        anchor: pickButton,
        candidates,
        container: host,
        onPick: raw => setReference(control, isEntity, raw)
      });
    };

    // Toggle one component section collapsed/expanded (view-local; never a world write).
    const toggleCollapse = (header: HTMLElement): void => {
      const section = header.closest<HTMLElement>("[data-section]");
      const name = section?.dataset.component;
      if (!section || !name) return;
      if (collapsed.has(name)) collapsed.delete(name);
      else collapsed.add(name);
      section.toggleAttribute("data-collapsed", collapsed.has(name));
    };

    // Open the popup a clicked control asks for (kebab / reference / add-component); true if one opened.
    const openPopupFor = (node: Element): boolean => {
      const kebab = node.closest<HTMLElement>("[data-kebab]");
      if (kebab?.dataset.component) {
        const ids = singleId === undefined ? (snapshot?.selection ?? []) : [singleId];
        openKebab(kebab, ids, kebab.dataset.component);
        return true;
      }
      const pick = node.closest<HTMLElement>("[data-ref-pick]");
      if (pick) {
        showReferencePicker(pick);
        return true;
      }
      const add = node.closest<HTMLElement>("[data-add-component]");
      if (add && singleId !== undefined) {
        const entity = byId(singleId);
        if (entity) openAddPicker(add, entity);
        return true;
      }
      return false;
    };

    // ── Delegated listeners ──
    const onChange = (event: Event): void => {
      const node = event.target;
      if (!(node instanceof HTMLElement)) return;

      if (node.dataset.enable !== undefined && singleId !== undefined) {
        bridge().setEnabled(singleId, (node as HTMLInputElement).checked);
        return;
      }
      if (node.dataset.name !== undefined && singleId !== undefined) {
        const next = (node as HTMLInputElement).value.trim();
        if (next) bridge().rename(singleId, next);
        return;
      }

      const control = node.closest<HTMLElement>("[data-field-key]");
      if (!control) return;
      const binding = registry.get(control);
      if (binding) applyField(control, binding);
    };

    const onClick = (event: Event): void => {
      const node = event.target;
      if (!(node instanceof Element)) return;
      if (openPopupFor(node)) return;
      const header = node.closest<HTMLElement>("[data-section-header]");
      if (header) toggleCollapse(header);
    };

    body.addEventListener("change", onChange);
    body.addEventListener("click", onClick);

    // ── Close inline popups (kebab / add-picker) on an outside click / Escape ──
    const onDocumentPointerDown = (event: Event): void => {
      if (popupElement && event.target instanceof Node && !popupElement.contains(event.target)) {
        closePopups();
      }
    };
    const onDocumentKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") closePopups();
    };
    document.addEventListener("pointerdown", onDocumentPointerDown);
    document.addEventListener("keydown", onDocumentKeyDown);

    // ── The one snapshot subscription: rebuild on (epoch, selection) ──
    ctx.cleanup(
      onSnapshot(next => {
        snapshot = next;
        const selectionKey = next.selection.join(",");
        if (next.epoch === lastEpoch && selectionKey === lastSelectionKey) return;
        lastEpoch = next.epoch;
        lastSelectionKey = selectionKey;
        rebuild();
      })
    );

    ctx.cleanup(() => {
      closePopups();
      body.removeEventListener("change", onChange);
      body.removeEventListener("click", onClick);
      document.removeEventListener("pointerdown", onDocumentPointerDown);
      document.removeEventListener("keydown", onDocumentKeyDown);
    });
  }
});

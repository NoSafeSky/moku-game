/** @file Inspector island — snapshot selection → field controls per component → bridge.setField. */
import { createIsland } from "@moku-labs/web/browser";
import type { Commands, EditorBridge, Reflection } from "@nosafesky/ludemic";
import { getEditor, onSnapshot } from "../lib/editor-host";
import { readControl, renderControl } from "../lib/field-controls";

/**
 * The write-routing binding stamped per control during a rebuild: which entity + component + field a
 * control edits, so the delegated change handler can `readControl` it → `bridge.setField`.
 */
type FieldBinding = {
  id: Commands.EditorId;
  component: string;
  descriptor: Reflection.FieldDescriptor;
};

// Read one field's current value out of a component's (unknown, frozen) value object.
const fieldValue = (componentValue: unknown, key: string): unknown => {
  if (typeof componentValue === "object" && componentValue !== null) {
    return (componentValue as Record<string, unknown>)[key];
  }
  return undefined;
};

// A component group heading spanning both inspector grid columns.
const componentHeading = (name: string): HTMLElement => {
  const heading = document.createElement("div");
  heading.dataset.component = "";
  heading.textContent = name;
  return heading;
};

// The label cell (grid column 1) paired with one field control.
const fieldLabel = (label: string): HTMLElement => {
  const element = document.createElement("label");
  element.dataset.fieldLabel = "";
  element.textContent = label;
  return element;
};

// Append one component's label/control pairs to `children`, stamping each control's write-routing
// binding into `registry` so a later change event resolves back to (id, component, field).
const pushComponentControls = (
  children: Node[],
  registry: Map<HTMLElement, FieldBinding>,
  entity: EditorBridge.EntitySnapshot,
  component: EditorBridge.ComponentSnapshot
): void => {
  for (const descriptor of component.fields) {
    const control = renderControl(descriptor, fieldValue(component.value, descriptor.key));
    registry.set(control, { id: entity.id, component: component.name, descriptor });
    children.push(fieldLabel(descriptor.label), control);
  }
};

// Rebuild the inspector body for the selected entity: a heading + its controls, per component. Left
// empty when nothing is selected (the panel's :empty::before then shows the "Select an entity" hint).
const rebuildFields = (
  fields: HTMLElement,
  entity: EditorBridge.EntitySnapshot | undefined,
  registry: Map<HTMLElement, FieldBinding>
): void => {
  registry.clear();
  if (!entity) {
    fields.replaceChildren();
    return;
  }

  const children: Node[] = [];
  for (const component of entity.components) {
    if (component.fields.length === 0) continue;
    children.push(componentHeading(component.name));
    pushComponentControls(children, registry, entity, component);
  }
  fields.replaceChildren(...children);
};

/**
 * Inspector island — renders editable controls for the selected entity and writes edits via the bridge.
 *
 * The rebuild is gated on `(epoch, selectedId)`: a selection change re-materializes the controls (a
 * selection does not bump the epoch), and a world write bumps the epoch so a committed edit reflects on
 * the next poll. Each control is built by `field-controls.renderControl`; a delegated `change` reads it
 * back with `readControl` and routes `(id, component, key, value)` through `bridge.setField` — the ONLY
 * write path (never `commands`/`ecs`). A rejected write flags the control `data-invalid` with the reason.
 * The subscription + the change listener are released on destroy via `ctx.cleanup`.
 */
export const inspector = createIsland("inspector", {
  onMount(ctx) {
    const host = ctx.el as HTMLElement;
    const fields = host.querySelector<HTMLElement>("[data-fields]");
    if (!fields) return;

    const registry = new Map<HTMLElement, FieldBinding>();
    let lastEpoch = -1;
    let lastSelected: Commands.EditorId | undefined;

    ctx.cleanup(
      onSnapshot(snapshot => {
        // Rebuild only on a world write (epoch) or a different selection — a selection change does
        // not bump the epoch, so gate on both.
        const selectedId = snapshot.selection[0];
        const unchanged = snapshot.epoch === lastEpoch && selectedId === lastSelected;
        if (unchanged) return;
        lastEpoch = snapshot.epoch;
        lastSelected = selectedId;
        const entity =
          selectedId === undefined
            ? undefined
            : snapshot.entities.find(candidate => candidate.id === selectedId);
        rebuildFields(fields, entity, registry);
      })
    );

    const onChange = (event: Event): void => {
      const node = event.target;
      if (!(node instanceof Element)) return;
      const control = node.closest<HTMLElement>("[data-field-key]");
      if (!control) return;
      const binding = registry.get(control);
      if (!binding) return;

      delete control.dataset.invalid;
      const value = readControl(control, binding.descriptor);
      const result = getEditor().bridge.setField(
        binding.id,
        binding.component,
        binding.descriptor.key,
        value
      );
      if (!result.ok) {
        control.dataset.invalid = "";
        control.title = result.error;
      }
      // The edited entity's view re-syncs via editor-host's epoch-gated poll (the write bumps the epoch).
    };
    fields.addEventListener("change", onChange);
    ctx.cleanup(() => fields.removeEventListener("change", onChange));
  }
});

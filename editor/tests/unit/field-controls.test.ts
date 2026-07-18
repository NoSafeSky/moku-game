// @vitest-environment happy-dom
import type { Reflection } from "@nosafesky/ludemic";
import { describe, expect, it, vi } from "vitest";
import { openReferencePicker, readControl, renderControl } from "../../src/lib/field-controls";

/** Grab one axis input from a vector2 control (guards instead of a non-null assertion). */
function axis(el: HTMLElement, name: "x" | "y"): HTMLInputElement {
  const input = el.querySelector<HTMLInputElement>(`[data-axis="${name}"]`);
  if (!input) throw new Error(`missing axis input "${name}"`);
  return input;
}

describe("field-controls", () => {
  describe("number", () => {
    const descriptor: Reflection.NumberField = {
      kind: "number",
      key: "x",
      label: "X",
      min: 0,
      max: 100,
      step: 5
    };

    it("renders a number input seeded with the value + min/max/step + identity data-*", () => {
      const el = renderControl(descriptor, 42) as HTMLInputElement;

      expect(el.tagName).toBe("INPUT");
      expect(el.type).toBe("number");
      expect(el.value).toBe("42");
      expect(el.min).toBe("0");
      expect(el.max).toBe("100");
      expect(el.step).toBe("5");
      expect(el.dataset.fieldKey).toBe("x");
      expect(el.dataset.fieldKind).toBe("number");
      expect(el.disabled).toBe(false);
    });

    it("round-trips the edited value through readControl", () => {
      const el = renderControl(descriptor, 42) as HTMLInputElement;
      el.value = "63";
      expect(readControl(el, descriptor)).toBe(63);
    });

    it("reads the raw (unclamped) value even when out of range — validation lives in the bridge", () => {
      const el = renderControl(descriptor, 0) as HTMLInputElement;
      el.value = "999";
      expect(readControl(el, descriptor)).toBe(999);
    });

    it("omits the min/max/step attributes a descriptor does not set", () => {
      const bare: Reflection.NumberField = { kind: "number", key: "n", label: "N" };
      const el = renderControl(bare, 1) as HTMLInputElement;

      expect(el.hasAttribute("min")).toBe(false);
      expect(el.hasAttribute("max")).toBe(false);
      expect(el.hasAttribute("step")).toBe(false);
    });
  });

  describe("boolean", () => {
    const descriptor: Reflection.BooleanField = {
      kind: "boolean",
      key: "visible",
      label: "Visible"
    };

    it("renders a checkbox reflecting the value", () => {
      const el = renderControl(descriptor, true) as HTMLInputElement;

      expect(el.type).toBe("checkbox");
      expect(el.checked).toBe(true);
      expect(el.dataset.fieldKind).toBe("boolean");
    });

    it("round-trips the checked state", () => {
      const el = renderControl(descriptor, true) as HTMLInputElement;
      el.checked = false;
      expect(readControl(el, descriptor)).toBe(false);
    });
  });

  describe("string", () => {
    const descriptor: Reflection.StringField = { kind: "string", key: "name", label: "Name" };

    it("renders a text input seeded with the value", () => {
      const el = renderControl(descriptor, "hero") as HTMLInputElement;

      expect(el.type).toBe("text");
      expect(el.value).toBe("hero");
    });

    it("round-trips the string", () => {
      const el = renderControl(descriptor, "hero") as HTMLInputElement;
      el.value = "villain";
      expect(readControl(el, descriptor)).toBe("villain");
    });
  });

  describe("color", () => {
    const descriptor: Reflection.ColorField = { kind: "color", key: "tint", label: "Tint" };

    it("renders a color input seeded with the hex value", () => {
      const el = renderControl(descriptor, "#3b82f6") as HTMLInputElement;

      expect(el.type).toBe("color");
      expect(el.value).toBe("#3b82f6");
    });

    it("round-trips the color", () => {
      const el = renderControl(descriptor, "#000000") as HTMLInputElement;
      el.value = "#ff0000";
      expect(readControl(el, descriptor)).toBe("#ff0000");
    });
  });

  describe("select", () => {
    const descriptor: Reflection.SelectField = {
      kind: "select",
      key: "blend",
      label: "Blend",
      options: ["normal", "add", "multiply"]
    };

    it("renders a select with one option per choice, seeded to the value", () => {
      const el = renderControl(descriptor, "add") as HTMLSelectElement;

      expect(el.tagName).toBe("SELECT");
      expect([...el.options].map(option => option.value)).toEqual(["normal", "add", "multiply"]);
      expect(el.value).toBe("add");
    });

    it("round-trips the selection", () => {
      const el = renderControl(descriptor, "add") as HTMLSelectElement;
      el.value = "multiply";
      expect(readControl(el, descriptor)).toBe("multiply");
    });
  });

  describe("vector2", () => {
    const descriptor: Reflection.Vector2Field = { kind: "vector2", key: "pos", label: "Position" };

    it("renders two number inputs seeded from {x,y}", () => {
      const el = renderControl(descriptor, { x: 10, y: 20 });

      expect(el.dataset.fieldKind).toBe("vector2");
      expect(el.dataset.fieldKey).toBe("pos");
      expect(axis(el, "x").type).toBe("number");
      expect(axis(el, "x").value).toBe("10");
      expect(axis(el, "y").value).toBe("20");
    });

    it("round-trips both axes", () => {
      const el = renderControl(descriptor, { x: 10, y: 20 });
      axis(el, "x").value = "11";
      axis(el, "y").value = "22";
      expect(readControl(el, descriptor)).toEqual({ x: 11, y: 22 });
    });
  });

  describe("readonly", () => {
    it("disables a scalar control and flags data-readonly", () => {
      const el = renderControl(
        { kind: "number", key: "x", label: "X", readonly: true },
        1
      ) as HTMLInputElement;

      expect(el.disabled).toBe(true);
      expect(el.dataset.readonly).toBe("");
    });

    it("disables both axes of a readonly vector2", () => {
      const el = renderControl(
        { kind: "vector2", key: "pos", label: "P", readonly: true },
        { x: 0, y: 0 }
      );
      const inputs = [...el.querySelectorAll<HTMLInputElement>("input")];

      expect(inputs).toHaveLength(2);
      expect(inputs.every(input => input.disabled)).toBe(true);
    });
  });

  describe("defensive coercion", () => {
    it("defaults a non-object vector2 value to the origin", () => {
      const el = renderControl({ kind: "vector2", key: "pos", label: "P" }, "not-a-vector");

      expect(axis(el, "x").value).toBe("0");
      expect(axis(el, "y").value).toBe("0");
    });

    it("seeds an empty string when a number value is not finite", () => {
      const el = renderControl(
        { kind: "number", key: "x", label: "X" },
        Number.NaN
      ) as HTMLInputElement;
      expect(el.value).toBe("");
    });

    it("throws when a non-input element is read as a scalar control", () => {
      const div = document.createElement("div");
      expect(() => readControl(div, { kind: "number", key: "x", label: "X" })).toThrow(/<input>/);
    });

    it("throws when a non-select element is read as a select control", () => {
      const div = document.createElement("div");
      expect(() =>
        readControl(div, { kind: "select", key: "s", label: "S", options: ["a"] })
      ).toThrow(/<select>/);
    });
  });

  describe("reference (entity-ref / asset-ref)", () => {
    it("renders an entity-ref chip: an icon + mono name + a ⋯ picker, value on data-ref-value", () => {
      const el = renderControl({ kind: "entity-ref", key: "target", label: "Target" }, 7);

      expect(el.dataset.fieldKind).toBe("entity-ref");
      expect(el.dataset.refValue).toBe("7");
      expect(el.querySelector("[data-ref-icon]")?.textContent).toBe("▶");
      expect(el.querySelector("[data-ref-name]")?.textContent).toBe("7");
      expect(el.querySelector("[data-ref-pick]")).not.toBeNull();
    });

    it("shows 'None' and an empty value when unset", () => {
      const el = renderControl({ kind: "asset-ref", key: "sprite", label: "Sprite" }, undefined);

      expect(el.dataset.refValue).toBe("");
      expect(el.querySelector("[data-ref-name]")?.textContent).toBe("None");
    });

    it("reads an entity-ref back as an EditorId number, unset as undefined", () => {
      const descriptor: Reflection.EntityRefField = { kind: "entity-ref", key: "t", label: "T" };
      expect(readControl(renderControl(descriptor, 7), descriptor)).toBe(7);
      expect(readControl(renderControl(descriptor, undefined), descriptor)).toBeUndefined();
    });

    it("reads an asset-ref back as its alias string", () => {
      const descriptor: Reflection.AssetRefField = { kind: "asset-ref", key: "s", label: "S" };
      expect(readControl(renderControl(descriptor, "coin.png"), descriptor)).toBe("coin.png");
    });

    it("disables the ⋯ picker button on a readonly reference", () => {
      const el = renderControl({ kind: "entity-ref", key: "t", label: "T", readonly: true }, 1);
      expect(el.querySelector<HTMLButtonElement>("[data-ref-pick]")?.disabled).toBe(true);
    });
  });

  describe("openReferencePicker (D9)", () => {
    it("renders a None row + one row per candidate; picking calls onPick and closes", () => {
      const anchor = document.createElement("button");
      document.body.append(anchor);
      const onPick = vi.fn();

      const close = openReferencePicker({
        anchor,
        candidates: [{ value: "3", label: "Player" }],
        onPick
      });

      const options = [
        ...(document.querySelectorAll<HTMLButtonElement>("[data-ref-picker] [data-ref-option]") ??
          [])
      ];
      expect(options).toHaveLength(2); // None + Player
      options[1]?.click();

      expect(onPick).toHaveBeenCalledWith("3");
      expect(document.querySelector("[data-ref-picker]")).toBeNull();
      close(); // idempotent — already closed
      anchor.remove();
    });

    it("the None row picks undefined (clear)", () => {
      const anchor = document.createElement("button");
      document.body.append(anchor);
      const onPick = vi.fn();

      openReferencePicker({ anchor, candidates: [], onPick });
      document.querySelector<HTMLButtonElement>("[data-ref-picker] [data-ref-option]")?.click();

      expect(onPick).toHaveBeenCalledWith(undefined);
      anchor.remove();
    });
  });

  describe("numeric drag-scrub (F3)", () => {
    it("updates the value on a horizontal drag and fires change on release", () => {
      const el = renderControl(
        { kind: "number", key: "x", label: "X", step: 1 },
        10
      ) as HTMLInputElement;
      const changed = vi.fn();
      el.addEventListener("change", changed);

      el.dispatchEvent(new MouseEvent("pointerdown", { clientX: 0, button: 0 }));
      globalThis.dispatchEvent(new MouseEvent("pointermove", { clientX: 20 }));
      globalThis.dispatchEvent(new MouseEvent("pointerup", {}));

      expect(el.value).toBe("30"); // 10 + 20px * step(1)
      expect(changed).toHaveBeenCalledTimes(1);
    });

    it("leaves the value untouched and fires no change on a zero-move press (text-edit fallthrough)", () => {
      const el = renderControl({ kind: "number", key: "x", label: "X" }, 10) as HTMLInputElement;
      const changed = vi.fn();
      el.addEventListener("change", changed);

      el.dispatchEvent(new MouseEvent("pointerdown", { clientX: 5, button: 0 }));
      globalThis.dispatchEvent(new MouseEvent("pointermove", { clientX: 6 })); // within threshold
      globalThis.dispatchEvent(new MouseEvent("pointerup", {}));

      expect(el.value).toBe("10");
      expect(changed).not.toHaveBeenCalled();
    });

    it("does not scrub a readonly number", () => {
      const el = renderControl(
        { kind: "number", key: "x", label: "X", readonly: true },
        10
      ) as HTMLInputElement;

      el.dispatchEvent(new MouseEvent("pointerdown", { clientX: 0, button: 0 }));
      globalThis.dispatchEvent(new MouseEvent("pointermove", { clientX: 30 }));
      globalThis.dispatchEvent(new MouseEvent("pointerup", {}));

      expect(el.value).toBe("10");
    });
  });
});

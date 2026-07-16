// @vitest-environment happy-dom
import type { Reflection } from "@nosafesky/ludemic";
import { describe, expect, it } from "vitest";
import { readControl, renderControl } from "../../src/lib/field-controls";

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
});

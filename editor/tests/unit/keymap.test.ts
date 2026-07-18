// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { isTextInputTarget, type KeyStroke, resolveShortcut } from "../../src/lib/keymap";

/** Build a keystroke with no modifiers, overriding as needed. */
const stroke = (over: Partial<KeyStroke> & { key: string }): KeyStroke => ({
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...over
});

describe("keymap · resolveShortcut", () => {
  it("maps the W/E/R/T tool keys to gizmo modes (case-insensitive)", () => {
    expect(resolveShortcut(stroke({ key: "w" }))).toBe("tool-translate");
    expect(resolveShortcut(stroke({ key: "E" }))).toBe("tool-rotate");
    expect(resolveShortcut(stroke({ key: "r" }))).toBe("tool-scale");
    expect(resolveShortcut(stroke({ key: "T" }))).toBe("tool-rect");
  });

  it("maps F to focus and Delete/Backspace to delete", () => {
    expect(resolveShortcut(stroke({ key: "f" }))).toBe("focus");
    expect(resolveShortcut(stroke({ key: "Delete" }))).toBe("delete");
    expect(resolveShortcut(stroke({ key: "Backspace" }))).toBe("delete");
  });

  it("maps the Ctrl/Cmd bindings (duplicate / save / select-all / redo)", () => {
    expect(resolveShortcut(stroke({ key: "d", ctrlKey: true }))).toBe("duplicate");
    expect(resolveShortcut(stroke({ key: "s", metaKey: true }))).toBe("save");
    expect(resolveShortcut(stroke({ key: "a", ctrlKey: true }))).toBe("select-all");
    expect(resolveShortcut(stroke({ key: "y", ctrlKey: true }))).toBe("redo");
  });

  it("resolves undo vs redo from Ctrl+Z ± Shift", () => {
    expect(resolveShortcut(stroke({ key: "z", ctrlKey: true }))).toBe("undo");
    expect(resolveShortcut(stroke({ key: "z", ctrlKey: true, shiftKey: true }))).toBe("redo");
  });

  it("does not fire a plain tool key while a modifier is held", () => {
    expect(resolveShortcut(stroke({ key: "w", ctrlKey: true }))).toBeUndefined();
  });

  it("ignores any Alt combo", () => {
    expect(resolveShortcut(stroke({ key: "d", ctrlKey: true, altKey: true }))).toBeUndefined();
    expect(resolveShortcut(stroke({ key: "w", altKey: true }))).toBeUndefined();
  });

  it("returns undefined for an unbound key", () => {
    expect(resolveShortcut(stroke({ key: "q" }))).toBeUndefined();
  });
});

describe("keymap · isTextInputTarget", () => {
  it("is true for input / textarea / select / contenteditable", () => {
    expect(isTextInputTarget(document.createElement("input"))).toBe(true);
    expect(isTextInputTarget(document.createElement("textarea"))).toBe(true);
    expect(isTextInputTarget(document.createElement("select"))).toBe(true);
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    expect(isTextInputTarget(editable)).toBe(true);
  });

  it("is false for a plain element or a null target", () => {
    expect(isTextInputTarget(document.createElement("div"))).toBe(false);
    // eslint-disable-next-line unicorn/no-null -- event.target is `EventTarget | null`; null is the case under test
    expect(isTextInputTarget(null)).toBe(false);
  });
});

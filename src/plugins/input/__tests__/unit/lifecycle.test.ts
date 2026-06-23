import { describe, expect, it, vi } from "vitest";

import {
  createInputSystem,
  createKeydownHandler,
  createKeyupHandler,
  createPointerHandler
} from "../../lifecycle";
import { createState } from "../../state";
import type { Config, KeyboardEventLike, PointerEventLike } from "../../types";

// ─── helpers ──────────────────────────────────────────────────

const defaultConfig: Config = {
  target: "window",
  pointer: true,
  keyboard: true,
  preventDefault: false
};

const makeState = (config: Config = defaultConfig) =>
  createState({ global: {} as Readonly<Record<string, unknown>>, config });

const makeKey = (key: string, preventDefaultFn = vi.fn()): KeyboardEventLike => ({
  key,
  preventDefault: preventDefaultFn
});

const makePointer = (clientX: number, clientY: number, buttons: number): PointerEventLike => ({
  clientX,
  clientY,
  buttons
});

// ─── keydown handler ──────────────────────────────────────────

describe("createKeydownHandler", () => {
  it("adds key to down and pressed on first keydown", () => {
    const state = makeState();
    const handler = createKeydownHandler(state, false);

    handler(makeKey("ArrowRight"));

    expect(state.down.has("ArrowRight")).toBe(true);
    expect(state.pressed.has("ArrowRight")).toBe(true);
  });

  it("does NOT add to pressed on repeated keydown (key-repeat suppression)", () => {
    const state = makeState();
    const handler = createKeydownHandler(state, false);

    handler(makeKey("Space"));
    expect(state.pressed.has("Space")).toBe(true);

    // Simulate key-repeat: clear pressed as the system would, key stays in down
    state.pressed.clear();
    handler(makeKey("Space"));

    expect(state.pressed.has("Space")).toBe(false);
    expect(state.down.has("Space")).toBe(true);
  });

  it("calls preventDefault when configured", () => {
    const state = makeState();
    const handler = createKeydownHandler(state, true);
    const preventDefaultFn = vi.fn();

    handler(makeKey("ArrowLeft", preventDefaultFn));

    expect(preventDefaultFn).toHaveBeenCalledOnce();
  });

  it("does NOT call preventDefault when not configured", () => {
    const state = makeState();
    const handler = createKeydownHandler(state, false);
    const preventDefaultFn = vi.fn();

    handler(makeKey("ArrowLeft", preventDefaultFn));

    expect(preventDefaultFn).not.toHaveBeenCalled();
  });
});

// ─── keyup handler ────────────────────────────────────────────

describe("createKeyupHandler", () => {
  it("removes key from down and adds to released on keyup", () => {
    const state = makeState();

    // Press first
    state.down.add("Space");
    const handler = createKeyupHandler(state, false);
    handler(makeKey("Space"));

    expect(state.down.has("Space")).toBe(false);
    expect(state.released.has("Space")).toBe(true);
  });

  it("calls preventDefault on keyup when configured", () => {
    const state = makeState();
    state.down.add("Enter");
    const handler = createKeyupHandler(state, true);
    const preventDefaultFn = vi.fn();

    handler(makeKey("Enter", preventDefaultFn));

    expect(preventDefaultFn).toHaveBeenCalledOnce();
  });
});

// ─── pointer handler ──────────────────────────────────────────

describe("createPointerHandler", () => {
  it("updates pointer position on pointermove", () => {
    const state = makeState();
    const handler = createPointerHandler(state);

    handler(makePointer(42, 100, 0));

    expect(state.pointer.x).toBe(42);
    expect(state.pointer.y).toBe(100);
  });

  it("updates pointer buttons bitmask", () => {
    const state = makeState();
    const handler = createPointerHandler(state);

    handler(makePointer(0, 0, 3));

    expect(state.pointer.buttons).toBe(3);
  });
});

// ─── input system (snapshot roll + edge-set clear) ────────────

describe("createInputSystem", () => {
  it("produces a snapshot that reflects current down/pressed/released sets", () => {
    const state = makeState();
    state.down.add("ArrowRight");
    state.pressed.add("ArrowRight");

    const system = createInputSystem(state);
    system({} as never, 0);

    expect(state.snapshot.isDown("ArrowRight")).toBe(true);
    expect(state.snapshot.justPressed("ArrowRight")).toBe(true);
    expect(state.snapshot.justReleased("ArrowRight")).toBe(false);
  });

  it("clears pressed and released after producing the snapshot", () => {
    const state = makeState();
    state.down.add("Space");
    state.pressed.add("Space");
    state.released.add("Escape");

    const system = createInputSystem(state);
    system({} as never, 0);

    // The snapshot captured the edge sets...
    expect(state.snapshot.justPressed("Space")).toBe(true);
    expect(state.snapshot.justReleased("Escape")).toBe(true);

    // ...but the mutable sets are cleared
    expect(state.pressed.size).toBe(0);
    expect(state.released.size).toBe(0);
  });

  it("justPressed is false on frame 2 while key is still held", () => {
    const state = makeState();
    const system = createInputSystem(state);

    // Frame 1: key goes down
    state.down.add("ArrowUp");
    state.pressed.add("ArrowUp");
    system({} as never, 0);
    expect(state.snapshot.justPressed("ArrowUp")).toBe(true);

    // Frame 2: key still down, no new press edge
    system({} as never, 0);
    expect(state.snapshot.isDown("ArrowUp")).toBe(true);
    expect(state.snapshot.justPressed("ArrowUp")).toBe(false);
  });

  it("justReleased is false on the frame after the release frame", () => {
    const state = makeState();
    const system = createInputSystem(state);

    // Frame 1: key pressed
    state.down.add("ArrowDown");
    state.pressed.add("ArrowDown");
    system({} as never, 0);

    // Frame 2: key released
    state.down.delete("ArrowDown");
    state.released.add("ArrowDown");
    system({} as never, 0);
    expect(state.snapshot.justReleased("ArrowDown")).toBe(true);

    // Frame 3: no edge — justReleased should now be false
    system({} as never, 0);
    expect(state.snapshot.justReleased("ArrowDown")).toBe(false);
  });

  it("snapshot pointer reflects current pointer state", () => {
    const state = makeState();
    state.pointer.x = 15;
    state.pointer.y = 30;
    state.pointer.buttons = 1;

    const system = createInputSystem(state);
    system({} as never, 0);

    expect(state.snapshot.pointer).toEqual({ x: 15, y: 30, buttons: 1 });
  });

  it("snapshot is stable within the frame (same object reference until next tick)", () => {
    const state = makeState();
    const system = createInputSystem(state);
    system({} as never, 0);

    const snap1 = state.snapshot;
    // No new tick — snapshot object should be the same
    const snap2 = state.snapshot;
    expect(snap1).toBe(snap2);
  });
});

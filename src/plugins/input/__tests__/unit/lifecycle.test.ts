import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createInputSystem,
  createKeydownHandler,
  createKeyupHandler,
  createPointerHandler,
  start,
  stop
} from "../../lifecycle";
import { createState } from "../../state";
import type { Config, InputContext, KeyboardEventLike, PointerEventLike } from "../../types";

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

// ─── start() target resolution + listener wiring ──────────────

/** A spy-backed EventTarget that records add/removeEventListener calls. */
const makeSpyTarget = () => {
  const added: Array<{ type: string; fn: EventListener }> = [];
  const removed: Array<{ type: string; fn: EventListener }> = [];
  const target: EventTarget = {
    addEventListener: ((type: string, fn: EventListener) => {
      added.push({ type, fn });
    }) as EventTarget["addEventListener"],
    removeEventListener: ((type: string, fn: EventListener) => {
      removed.push({ type, fn });
    }) as EventTarget["removeEventListener"],
    dispatchEvent: (() => true) as EventTarget["dispatchEvent"]
  };
  return { target, added, removed };
};

/** Builds an InputContext with a no-op scheduler require and a fresh state. */
const makeStartCtx = (
  config: Config
): { ctx: InputContext; addSystem: ReturnType<typeof vi.fn> } => {
  const global = {} as Readonly<Record<string, unknown>>;
  const state = createState({ global, config });
  const addSystem = vi.fn().mockReturnValue(() => {
    /* no-op unsubscribe */
  });
  const ctx: InputContext = {
    global,
    config,
    state,
    require: (() => ({ addSystem })) as unknown as InputContext["require"]
  };
  return { ctx, addSystem };
};

/**
 * Installs temporary addEventListener/removeEventListener spies on globalThis so
 * the `?? globalThis` fallback branch in resolveTarget can actually attach
 * listeners (Node's bare globalThis has no EventTarget methods). Returns a
 * restore function.
 */
const stubGlobalEventTarget = () => {
  const g = globalThis as Record<string, unknown>;
  const hadAdd = "addEventListener" in g;
  const hadRemove = "removeEventListener" in g;
  g.addEventListener = vi.fn();
  g.removeEventListener = vi.fn();
  return () => {
    if (!hadAdd) delete g.addEventListener;
    if (!hadRemove) delete g.removeEventListener;
  };
};

describe("start() — target resolution", () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).document;
  });

  it('resolves target:"window" to globalThis.window when present', async () => {
    const { target, added } = makeSpyTarget();
    (globalThis as Record<string, unknown>).window = target;

    const { ctx } = makeStartCtx({
      target: "window",
      keyboard: true,
      pointer: false,
      preventDefault: false
    });
    await start(ctx);

    // Listeners were attached to the resolved window target, not globalThis.
    expect(added.length).toBeGreaterThan(0);
    expect(ctx.state.listeners.every(l => l.target === target)).toBe(true);
  });

  it('resolves target:"window" to globalThis when window is absent (node fallback)', async () => {
    delete (globalThis as Record<string, unknown>).window;
    const restore = stubGlobalEventTarget();

    const { ctx } = makeStartCtx({
      target: "window",
      keyboard: true,
      pointer: false,
      preventDefault: false
    });
    await start(ctx);

    // Falls back to globalThis itself.
    expect(ctx.state.listeners.length).toBeGreaterThan(0);
    expect(
      ctx.state.listeners.every(l => l.target === (globalThis as unknown as EventTarget))
    ).toBe(true);

    restore();
  });

  it("resolves a selector via document.querySelector when it matches", async () => {
    const { target } = makeSpyTarget();
    const querySelector = vi.fn().mockReturnValue(target);
    (globalThis as Record<string, unknown>).document = { querySelector };

    const { ctx } = makeStartCtx({
      target: "#app",
      keyboard: true,
      pointer: false,
      preventDefault: false
    });
    await start(ctx);

    expect(querySelector).toHaveBeenCalledWith("#app");
    expect(ctx.state.listeners.every(l => l.target === target)).toBe(true);
  });

  it("falls back to globalThis when the selector matches nothing", async () => {
    const querySelector = vi.fn().mockReturnValue(undefined);
    (globalThis as Record<string, unknown>).document = { querySelector };
    const restore = stubGlobalEventTarget();

    const { ctx } = makeStartCtx({
      target: "#missing",
      keyboard: true,
      pointer: false,
      preventDefault: false
    });
    await start(ctx);

    expect(querySelector).toHaveBeenCalledWith("#missing");
    expect(
      ctx.state.listeners.every(l => l.target === (globalThis as unknown as EventTarget))
    ).toBe(true);

    restore();
  });

  it("falls back to globalThis when no document exists for a selector target", async () => {
    delete (globalThis as Record<string, unknown>).document;
    const restore = stubGlobalEventTarget();

    const { ctx } = makeStartCtx({
      target: "#app",
      keyboard: true,
      pointer: false,
      preventDefault: false
    });
    await start(ctx);

    expect(
      ctx.state.listeners.every(l => l.target === (globalThis as unknown as EventTarget))
    ).toBe(true);

    restore();
  });
});

describe("start() — keyboard/pointer toggles", () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
  });

  it("attaches only keyboard listeners when {keyboard:true, pointer:false}", async () => {
    const { target } = makeSpyTarget();
    (globalThis as Record<string, unknown>).window = target;

    const { ctx, addSystem } = makeStartCtx({
      target: "window",
      keyboard: true,
      pointer: false,
      preventDefault: false
    });
    await start(ctx);

    const types = ctx.state.listeners.map(l => l.type).toSorted();
    expect(types).toEqual(["keydown", "keyup"]);
    expect(addSystem).toHaveBeenCalledWith("input", expect.any(Function));
  });

  it("attaches only pointer listeners when {keyboard:false, pointer:true}", async () => {
    const { target } = makeSpyTarget();
    (globalThis as Record<string, unknown>).window = target;

    const { ctx } = makeStartCtx({
      target: "window",
      keyboard: false,
      pointer: true,
      preventDefault: false
    });
    await start(ctx);

    const types = ctx.state.listeners.map(l => l.type).toSorted();
    expect(types).toEqual(["pointerdown", "pointermove", "pointerup"]);
  });

  it("attaches no DOM listeners when {keyboard:false, pointer:false}", async () => {
    const { target } = makeSpyTarget();
    (globalThis as Record<string, unknown>).window = target;

    const { ctx, addSystem } = makeStartCtx({
      target: "window",
      keyboard: false,
      pointer: false,
      preventDefault: false
    });
    await start(ctx);

    expect(ctx.state.listeners).toHaveLength(0);
    // The input system is still registered regardless of listener config.
    expect(addSystem).toHaveBeenCalledWith("input", expect.any(Function));
  });

  it("attached keydown handler calls preventDefault when preventDefault:true", async () => {
    const { target, added } = makeSpyTarget();
    (globalThis as Record<string, unknown>).window = target;

    const { ctx } = makeStartCtx({
      target: "window",
      keyboard: true,
      pointer: false,
      preventDefault: true
    });
    await start(ctx);

    const keydown = added.find(l => l.type === "keydown");
    const preventDefault = vi.fn();
    keydown?.fn({ key: "Space", preventDefault } as unknown as Event);

    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("attached keydown handler does NOT call preventDefault when preventDefault:false", async () => {
    const { target, added } = makeSpyTarget();
    (globalThis as Record<string, unknown>).window = target;

    const { ctx } = makeStartCtx({
      target: "window",
      keyboard: true,
      pointer: false,
      preventDefault: false
    });
    await start(ctx);

    const keydown = added.find(l => l.type === "keydown");
    const preventDefault = vi.fn();
    keydown?.fn({ key: "Space", preventDefault } as unknown as Event);

    expect(preventDefault).not.toHaveBeenCalled();
  });
});

describe("stop() — teardown", () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
  });

  it("removes every listener it attached and empties the array", async () => {
    const { target, added, removed } = makeSpyTarget();
    (globalThis as Record<string, unknown>).window = target;

    const { ctx } = makeStartCtx({
      target: "window",
      keyboard: true,
      pointer: true,
      preventDefault: false
    });
    await start(ctx);
    expect(added.length).toBe(5);

    await stop({ global: ctx.global });

    expect(removed.length).toBe(5);
    expect(ctx.state.listeners).toHaveLength(0);
  });

  it("is a no-op when no listeners were ever registered for the global (WeakMap miss)", async () => {
    // A global that was never passed through start() has no registry entry.
    await expect(stop({ global: {} })).resolves.toBeUndefined();
  });

  it("is idempotent — a second stop with the same global does not throw", async () => {
    const { target } = makeSpyTarget();
    (globalThis as Record<string, unknown>).window = target;

    const { ctx } = makeStartCtx({
      target: "window",
      keyboard: true,
      pointer: false,
      preventDefault: false
    });
    await start(ctx);
    await stop({ global: ctx.global });

    await expect(stop({ global: ctx.global })).resolves.toBeUndefined();
  });
});

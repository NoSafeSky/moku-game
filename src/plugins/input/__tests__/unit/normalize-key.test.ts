/**
 * @file Cycle 5 — normalizeKey unit tests (RED-first).
 *
 * Tests for key normalization behavior in the injection methods
 * (`keyDown`, `keyUp`, `keyPress`) and the internal `normalizeKey` helper.
 */
import { describe, expect, it } from "vitest";

import type { World } from "../../../scheduler/types";
import { createApi, normalizeKey } from "../../api";
import { createInputSystem } from "../../lifecycle";
import { createState } from "../../state";
import type { Config, InputContext } from "../../types";

/** A throwaway world handle — the input-stage system never reads it. */
const stubWorld = {} as unknown as World;

/** Roll one input-stage tick so api.snapshot() reflects injected state. */
const rollFrame = (ctx: InputContext) => createInputSystem(ctx.state)(stubWorld, 0);

const defaultConfig: Config = {
  target: "window",
  pointer: true,
  keyboard: true,
  preventDefault: false
};

const makeCtx = (config: Config = defaultConfig): InputContext => ({
  global: {},
  config,
  state: createState({ global: {} as Readonly<Record<string, unknown>>, config }),
  require: (() => {
    throw new Error("require not used by api");
  }) as InputContext["require"]
});

// ─── normalizeKey ──────────────────────────────────────────────

describe("normalizeKey", () => {
  it('maps "Space" to " "', () => {
    expect(normalizeKey("Space")).toBe(" ");
  });

  it('maps "Spacebar" to " "', () => {
    expect(normalizeKey("Spacebar")).toBe(" ");
  });

  it('maps "Esc" to "Escape"', () => {
    expect(normalizeKey("Esc")).toBe("Escape");
  });

  it('passes "ArrowLeft" through unchanged', () => {
    expect(normalizeKey("ArrowLeft")).toBe("ArrowLeft");
  });

  it('passes "w" through unchanged', () => {
    expect(normalizeKey("w")).toBe("w");
  });

  it('passes " " (canonical space) through unchanged', () => {
    expect(normalizeKey(" ")).toBe(" ");
  });

  it('passes "Escape" (already canonical) through unchanged', () => {
    expect(normalizeKey("Escape")).toBe("Escape");
  });

  it("passes digits through unchanged", () => {
    expect(normalizeKey("1")).toBe("1");
  });

  it('passes "Enter" through unchanged', () => {
    expect(normalizeKey("Enter")).toBe("Enter");
  });
});

// ─── keyDown normalization ─────────────────────────────────────

describe("keyDown normalization (Cycle 5)", () => {
  it('keyDown("Space") sets isDown(" ") true, NOT isDown("Space")', () => {
    const ctx = makeCtx();
    const api = createApi(ctx);

    api.keyDown("Space");
    rollFrame(ctx);

    const snap = api.snapshot();
    expect(snap.isDown(" ")).toBe(true);
    expect(snap.isDown("Space")).toBe(false);
  });

  it('keyDown("Spacebar") sets isDown(" ") true', () => {
    const ctx = makeCtx();
    const api = createApi(ctx);

    api.keyDown("Spacebar");
    rollFrame(ctx);

    expect(api.snapshot().isDown(" ")).toBe(true);
  });

  it('keyDown("Esc") sets isDown("Escape") true, NOT isDown("Esc")', () => {
    const ctx = makeCtx();
    const api = createApi(ctx);

    api.keyDown("Esc");
    rollFrame(ctx);

    const snap = api.snapshot();
    expect(snap.isDown("Escape")).toBe(true);
    expect(snap.isDown("Esc")).toBe(false);
  });

  it('keyDown("ArrowLeft") passes through unchanged', () => {
    const ctx = makeCtx();
    const api = createApi(ctx);

    api.keyDown("ArrowLeft");
    rollFrame(ctx);

    expect(api.snapshot().isDown("ArrowLeft")).toBe(true);
  });
});

// ─── keyUp normalization ───────────────────────────────────────

describe("keyUp normalization (Cycle 5)", () => {
  it('keyUp("Space") sets justReleased(" ") true', () => {
    const ctx = makeCtx();
    const api = createApi(ctx);

    // Press and hold the canonical key, then release via alias.
    api.keyDown(" ");
    rollFrame(ctx);

    api.keyUp("Space");
    rollFrame(ctx);

    const snap = api.snapshot();
    expect(snap.justReleased(" ")).toBe(true);
    expect(snap.isDown(" ")).toBe(false);
    expect(snap.justReleased("Space")).toBe(false);
  });

  it('keyUp("Esc") sets justReleased("Escape") true', () => {
    const ctx = makeCtx();
    const api = createApi(ctx);

    api.keyDown("Escape");
    rollFrame(ctx);

    api.keyUp("Esc");
    rollFrame(ctx);

    expect(api.snapshot().justReleased("Escape")).toBe(true);
    expect(api.snapshot().justReleased("Esc")).toBe(false);
  });
});

// ─── keyPress normalization ────────────────────────────────────

describe("keyPress normalization (Cycle 5)", () => {
  it('keyPress("Esc") fires justPressed("Escape") and justReleased("Escape"), not "Esc"', () => {
    const ctx = makeCtx();
    const api = createApi(ctx);

    api.keyPress("Esc");
    rollFrame(ctx);

    const snap = api.snapshot();
    expect(snap.justPressed("Escape")).toBe(true);
    expect(snap.justReleased("Escape")).toBe(true);
    expect(snap.isDown("Escape")).toBe(false);
    expect(snap.justPressed("Esc")).toBe(false);
    expect(snap.justReleased("Esc")).toBe(false);
  });

  it('keyPress("Space") fires justPressed(" ") and justReleased(" "), key never stuck', () => {
    const ctx = makeCtx();
    const api = createApi(ctx);

    api.keyPress("Space");
    rollFrame(ctx);

    const snap = api.snapshot();
    expect(snap.justPressed(" ")).toBe(true);
    expect(snap.justReleased(" ")).toBe(true);
    expect(snap.isDown(" ")).toBe(false);
    expect(snap.justPressed("Space")).toBe(false);
  });

  it("keyPress normalization does not persist to the following frame", () => {
    const ctx = makeCtx();
    const api = createApi(ctx);

    api.keyPress("Esc");
    rollFrame(ctx); // frame with tap

    rollFrame(ctx); // next frame — edges must be clear
    const next = api.snapshot();
    expect(next.justPressed("Escape")).toBe(false);
    expect(next.justReleased("Escape")).toBe(false);
  });
});

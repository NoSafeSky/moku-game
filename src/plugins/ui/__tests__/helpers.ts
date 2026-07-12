/**
 * @file ui plugin — shared test helpers.
 *
 * Provides a config factory, a "started" state (real Pixi root Container — Pixi
 * scene-graph objects work in Node without a GPU), and a scriptable input dep whose
 * snapshot reads a mutable pointer. Not a test file itself — vitest only collects
 * `*.test.ts`.
 */
import { Container } from "pixi.js";
import { createState } from "../state";
import type { Config, InputDep, State } from "../types";

/** Build a ui config with optional overrides (matches the plugin's defaults). */
export const makeConfig = (overrides: Partial<Config> = {}): Config => ({
  textColor: 0xff_ff_ff,
  fontSize: 20,
  fontFamily: "sans-serif",
  buttonColor: 0x33_55_ff,
  buttonHoverColor: 0x44_66_ff,
  panelColor: 0x14_18_21,
  panelAlpha: 0.92,
  backdropColor: 0x00_00_00,
  backdropAlpha: 0.6,
  padding: 12,
  width: 800,
  height: 600,
  ...overrides
});

/** A ui state with a real root Container — the started, stage-present shape. */
export const startedState = (config: Config = makeConfig()): State => {
  const state = createState({ global: {}, config });
  state.root = new Container();
  return state;
};

/** A scriptable pointer + {@link InputDep} whose snapshot reads the live pointer object. */
export const makeInput = (initial?: {
  x?: number;
  y?: number;
  buttons?: number;
}): { input: InputDep; pointer: { x: number; y: number; buttons: number } } => {
  const pointer = { x: 0, y: 0, buttons: 0, ...initial };
  const input: InputDep = { snapshot: () => ({ pointer }) };
  return { input, pointer };
};

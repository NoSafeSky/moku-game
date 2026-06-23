/**
 * Input plugin — Standard tier.
 *
 * Polled keyboard/pointer input as a per-frame snapshot. Manages DOM listeners
 * (onStart/onStop) and registers the input stage system. Emits no events.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { schedulerPlugin } from "../scheduler";
import { createApi } from "./api";
import { start, stop } from "./lifecycle";
import { createState } from "./state";
import type { Config } from "./types";

const defaultConfig: Config = {
  target: "window",
  pointer: true,
  keyboard: true,
  preventDefault: false
};

export const inputPlugin = createPlugin("input", {
  depends: [schedulerPlugin],
  config: defaultConfig,
  createState,
  api: createApi,
  onStart: start, // @no-resource-check — attaches keyboard/pointer DOM listeners (spec/06 §3)
  onStop: stop // @no-resource-check — removes the DOM listeners (spec/06 §4)
});

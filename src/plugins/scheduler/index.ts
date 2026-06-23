/**
 * Scheduler plugin — Standard tier.
 *
 * Typed facade over the ECS world's stage/system registry. Emits no events.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { ecsPlugin } from "../ecs";
import { createApi } from "./api";
import { createState } from "./state";
import type { Config } from "./types";

const defaultConfig: Config = { strictStages: true };

export const schedulerPlugin = createPlugin("scheduler", {
  depends: [ecsPlugin],
  config: defaultConfig,
  createState,
  api: createApi
});

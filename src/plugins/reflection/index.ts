import { createPlugin } from "../../config";
import { ecsPlugin } from "../ecs";
import { createApi } from "./api";
import { createState } from "./state";
import type { Config } from "./types";

const defaultConfig: Config = { humanizeLabels: true };

/**
 * reflection plugin — Standard tier.
 *
 * Field-schema registry for named ECS components: infer descriptors from live values, or
 * register a typed schema built from the `field.*` builders; `validate` a partial value against
 * its descriptors. A registered schema always wins over inference. Pure registry — no
 * onInit/onStart/onStop (it owns no runtime resource and resolves `ecs` lazily at call time via
 * `ctx.require(ecsPlugin)`, exactly like the scheduler's forwarding-facade pattern). Emits no
 * events, declares no hooks. Depends on `ecs` only — no edge to `commands` (rich validation
 * reaches `commands` through its `setValidator` seam, wired by a higher plugin).
 *
 * @see README.md
 */
export const reflectionPlugin = createPlugin("reflection", {
  depends: [ecsPlugin],
  config: defaultConfig,
  createState,
  api: createApi
});

// `field` is also re-exported standalone for module-scope schema authoring:
export { field } from "./field";
export type { FieldDescriptor, FieldSpec, Schema, ValidationResult } from "./types";

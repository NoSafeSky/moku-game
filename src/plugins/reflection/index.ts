/**
 * Standard tier — field-schema registry (infer + typed field.* schema) + validate.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { ecsPlugin } from "../ecs";
import { createApi } from "./api";
import { createState } from "./state";

export const reflectionPlugin = createPlugin("reflection", {
  depends: [ecsPlugin],
  config: { humanizeLabels: true },
  createState,
  api: createApi
});

export { field } from "./field";

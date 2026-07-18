import { createPlugin } from "../../config";
import { commandsPlugin } from "../commands";
import { componentRegistryPlugin } from "../component-registry";
import { ecsPlugin } from "../ecs";
import { editorGizmosPlugin } from "../editor-gizmos";
import { editorHistoryPlugin } from "../editor-history";
import { editorRuntimePlugin } from "../editor-runtime";
import { editorSelectionPlugin } from "../editor-selection";
import { hierarchyPlugin } from "../hierarchy";
import { mcpPlugin } from "../mcp";
import { reflectionPlugin } from "../reflection";
import { serializationPlugin } from "../serialization";
import { createApi } from "./api";
import { start } from "./lifecycle";
import { createState } from "./state";

/**
 * editor-bridge plugin — Complex tier.
 *
 * Typed facade for the Layer-3 `@nosafesky/moku-editor` app — the single `Api` the web shell
 * consumes (`gameApp["editor-bridge"]`), never `createCore`/`createCoreConfig`. Aggregates a
 * poll-on-epoch, immutable, HIERARCHICAL `snapshot()` from ecs + hierarchy + reflection +
 * selection + runtime + history (a FLAT entity array carrying `Node`-derived `name`/`enabled`/
 * `parent`/`children` + a `roots` seed set), and routes every write to the single write-authority:
 * simple edits (`setField`/`apply`/`rename`/`setEnabled`/`reorder`/`addComponent`/
 * `removeComponent`/`create*`) go through `editor-history.applyTracked` → `commands.applyRaw` as
 * one tracked step; the three COMPOUND ops (`reparent`/`delete`/`duplicate`) delegate to the pure
 * orchestrators in `authoring.ts`, gesture-bracketed BURSTS of the same primitives collapsing to
 * ONE undo entry — no new command kind. `listComponents` reads the Add-Component catalog
 * (`component-registry`) enriched with field schemas. Wires `commands.setValidator(reflection.validate)`
 * and the `editor-gizmos` gesture sink at `onStart`. Emits nothing; listens to nothing (pull-facade
 * — poll-on-epoch, spec/01 §2 kernel-bypass). Registered LAST in the `createCore` array (all eleven
 * edges point backwards).
 *
 * @see README.md
 */
export const editorBridgePlugin = createPlugin("editor-bridge", {
  depends: [
    ecsPlugin,
    reflectionPlugin,
    commandsPlugin,
    hierarchyPlugin,
    componentRegistryPlugin,
    editorSelectionPlugin,
    editorGizmosPlugin,
    editorHistoryPlugin,
    editorRuntimePlugin,
    serializationPlugin,
    mcpPlugin
  ],
  config: {},
  createState,
  api: createApi,
  onStart: start // @no-resource-check — deps-ready wiring: validator + gizmo gesture-sink seams, mcp F1 probe
});

export type {
  Api,
  ComponentCatalogEntryWithFields,
  ComponentSnapshot,
  CreateOptions,
  EditorSnapshot,
  EntitySnapshot,
  ReparentOptions
} from "./types";

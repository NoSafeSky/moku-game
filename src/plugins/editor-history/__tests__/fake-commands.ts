/**
 * @file editor-history plugin — shared fake `commands` API + log spy for unit tests.
 *
 * Mirrors the `commands` plugin's own `__tests__/mock-world.ts` precedent: a small
 * but behaviourally real double, not a real ECS-backed `commands` plugin. `apply`
 * computes an inverse from an in-memory field store (so round-trips are observable);
 * `applyRaw` applies the same way but is also recorded into `applyRawCalls` so tests
 * can assert exactly which commands were replayed, and in what order. Not a test file
 * itself — vitest only collects `*.test.ts` under `__tests__/unit` and `__tests__/integration`.
 */
import { vi } from "vitest";
import type { Command, CommandResult, EditorId, RawResult } from "../../commands/types";

/** A logger whose four levels are `vi.fn()` spies (mirrors `commands`' `makeLog`). */
export const makeLog = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
});

/** Build a branded `EditorId` from a raw number — test-only convenience. */
export const asEditorId = (n: number): EditorId => n as EditorId;

/** Read the `field` off a `setField`-kind command, `""` for any other kind. */
export const fieldOf = (command: Command): string =>
  command.kind === "setField" ? command.field : "";

/** Compose the in-memory field-store key for a `(id, component, field)` triple. */
const fieldKey = (id: EditorId, component: string, field: string): string =>
  `${id}:${component}:${field}`;

/**
 * Create a fake `commands` API double: `apply` computes a real inverse from an
 * in-memory `(id, component, field) -> value` store; `applyRaw` applies the same
 * way without computing an inverse, and every `applyRaw` call is recorded (in
 * order) into `applyRawCalls` for assertions on undo/redo replay order.
 *
 * @returns The fake `commands` API plus the backing `fields` store and call log.
 * @example
 * ```ts
 * const commands = makeFakeCommands();
 * commands.fields.set(commands.fieldKey(id, "Position", "x"), 0);
 * const result = commands.apply({ kind: "setField", id, component: "Position", field: "x", value: 5 });
 * ```
 */
export const makeFakeCommands = () => {
  const fields = new Map<string, unknown>();
  const applyRawCalls: Command[] = [];
  let rejectNextApply = false;

  const mutate = (command: Command): RawResult => {
    if (command.kind === "setField") {
      fields.set(fieldKey(command.id, command.component, command.field), command.value);
      return { ok: true, id: command.id };
    }
    if (command.kind === "spawn") return { ok: true, id: command.id ?? asEditorId(1) };
    return { ok: true, id: command.id };
  };

  const apply = vi.fn((command: Command): CommandResult => {
    if (rejectNextApply) {
      rejectNextApply = false;
      return { ok: false, error: "rejected for test" };
    }

    if (command.kind === "setField") {
      const key = fieldKey(command.id, command.component, command.field);
      const oldValue = fields.get(key);
      const result = mutate(command);
      if (!result.ok) return result;
      return {
        ok: true,
        inverse: {
          kind: "setField",
          id: command.id,
          component: command.component,
          field: command.field,
          value: oldValue
        }
      };
    }

    const result = mutate(command);
    if (!result.ok) return result;
    return { ok: true, inverse: { kind: "despawn", id: result.id } };
  });

  const applyRaw = vi.fn((command: Command): RawResult => {
    applyRawCalls.push(command);
    return mutate(command);
  });

  return {
    apply,
    applyRaw,
    applyRawCalls,
    fields,
    fieldKey,
    /** Make the NEXT `apply` call return `{ ok: false, error }` instead of applying. */
    rejectNextApply: (value: boolean): void => {
      rejectNextApply = value;
    }
  };
};

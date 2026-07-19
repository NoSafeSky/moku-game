/**
 * @file asset-store plugin — shared `URL` test double.
 *
 * A spy-instrumented mock of the structural `UrlLike` surface (`createObjectURL` /
 * `revokeObjectURL`) the plugin mints/revokes session `blob:` URLs through, reused by the api /
 * lifecycle unit tests and the integration test. Not a test file itself (no `.test.ts`), so vitest
 * does not collect it.
 */
import { type Mock, vi } from "vitest";
import type { UrlLike } from "../url";

/** A spied `UrlLike`, recording every minted/revoked URL for assertions. */
export type MockUrl = UrlLike & {
  createObjectURL: Mock;
  revokeObjectURL: Mock;
  /** URLs minted so far, in creation order. */
  readonly created: string[];
  /** URLs revoked so far, in call order. */
  readonly revoked: string[];
};

/** Build a spied `UrlLike` minting sequential `blob:mock/N` URLs. */
export const makeMockUrl = (): MockUrl => {
  const created: string[] = [];
  const revoked: string[] = [];
  let counter = 0;

  const createObjectURL = vi.fn(() => {
    const url = `blob:mock/${counter++}`;
    created.push(url);
    return url;
  });
  const revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url);
  });

  return { createObjectURL, revokeObjectURL, created, revoked };
};

/** Install a mock `URL` (createObjectURL/revokeObjectURL) on `globalThis`. Returns the mock + an uninstall. */
export const installUrl = (): { mock: MockUrl; uninstall: () => void } => {
  const mock = makeMockUrl();
  const globals = globalThis as { URL?: unknown };
  const previous = globals.URL;
  globals.URL = mock;

  return {
    mock,
    uninstall: () => {
      globals.URL = previous;
    }
  };
};

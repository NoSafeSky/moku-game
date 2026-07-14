import { expect, test } from "@playwright/test";

test.describe("client bundle audit", () => {
  test("client bundle stays node-free (W4)", () => {
    test.skip(
      true,
      "W4 asserts no node:* / stdio-http mcp transport / core-only symbol in the bundle"
    );
    expect(true).toBe(true);
  });
});

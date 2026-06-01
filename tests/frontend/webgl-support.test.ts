import assert from "node:assert/strict";
import test from "node:test";
import { webglUnavailableReason } from "../../src/visuals/webglSupport";

test("webgl support check fails closed outside a browser document", () => {
  assert.equal(webglUnavailableReason(), "The browser document is unavailable.");
});


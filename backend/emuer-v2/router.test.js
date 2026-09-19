"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { CONTRACT, CHAIN_ID, rewardKey, enabled } = require("./router");

test("v2 gateway is disabled unless explicitly enabled", () => {
  assert.equal(enabled({}), false);
  assert.equal(enabled({ EMUER_V2_ENABLED: "false" }), false);
  assert.equal(enabled({ EMUER_V2_ENABLED: "true" }), true);
});
test("v2 gateway is pinned to the verified Polygon deployment", () => {
  assert.equal(CONTRACT, "0x9c102cC3016C70767082b60196565878D9314864");
  assert.equal(CHAIN_ID, 137);
  const at = Date.parse("2026-10-01T00:00:00+09:00");
  assert.equal(rewardKey("passport-1", at), rewardKey("passport-1", at + 1000));
  assert.notEqual(rewardKey("passport-1", at), rewardKey("passport-2", at));
});

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { CONTRACT, CHAIN_ID, rewardKey, enabled } = require("./router");

test("v2 gateway requires explicit enable and the launch hold always wins", () => {
  const at = Date.parse("2026-10-01T00:00:00+09:00");
  const before = Date.parse("2026-09-30T23:59:59.999+09:00");

  assert.equal(enabled({}, at), false);
  assert.equal(enabled({ EMUER_V2_ENABLED: "false" }, at), false);
  assert.equal(enabled({ EMUER_V2_ENABLED: "true" }, before), false);
  assert.equal(enabled({ EMUER_V2_ENABLED: "true" }, at), true);
  assert.equal(enabled({ EMUER_V2_ENABLED: "true", EMUER_V2_LAUNCH_HOLD: "true" }, at), false);
  assert.equal(enabled({ EMUER_V2_ENABLED: "true", EMUER_V2_LAUNCH_HOLD: "false" }, at), true);
  assert.equal(enabled({ EMUER_V2_ENABLED: "true", EMUER_V2_LAUNCH_HOLD: "yes" }, at), false);
});
test("v2 gateway is pinned to the verified Polygon deployment", () => {
  assert.equal(CONTRACT, "0x9c102cC3016C70767082b60196565878D9314864");
  assert.equal(CHAIN_ID, 137);
  const at = Date.parse("2026-10-01T00:00:00+09:00");
  assert.equal(rewardKey("passport-1", at), rewardKey("passport-1", at + 1000));
  assert.notEqual(rewardKey("passport-1", at), rewardKey("passport-2", at));
});

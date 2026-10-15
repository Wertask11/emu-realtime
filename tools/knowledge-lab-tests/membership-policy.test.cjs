"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const p = require("../../backend/membership-policy");
test("approved prices/publication caps and retained limits have a future boundary", () => {
  assert.deepEqual(Object.values(p.PLANS).map(p => p.amount), [0, 500, 3000, 10000]);
  assert.equal(p.PLANS.light.post, 5);
  assert.deepEqual(p.storageLimits("guest", p.EFFECTIVE_AT - 1), { saved: 1000, drafts: 1, notes: 1000 });
  assert.deepEqual(p.storageLimits("guest", p.EFFECTIVE_AT), { saved: 10, drafts: 1, notes: 3 });
  assert.deepEqual(p.storageLimits("light", p.EFFECTIVE_AT), { saved: 100, drafts: 30, notes: 30 });
  for (const plan of ["plus", "pro"]) assert.deepEqual(p.storageLimits(plan, p.EFFECTIVE_AT), { saved: 1000, drafts: 1000, notes: 1000 });
  assert.equal(p.catalog().officialPass.futureSeriesForSale, false);
  assert.equal(p.catalog().ai.guaranteed, false);
});
test("JST calendar boundaries use unpadded existing Rules keys and cover December/leap years", () => {
  for (const [iso, key, end] of [
    ["2026-10-31T14:59:59Z", "m2026-10", "2026-10-31T15:00:00.000Z"],
    ["2026-10-31T15:00:00Z", "m2026-11", "2026-11-30T15:00:00.000Z"],
    ["2026-12-31T15:00:00Z", "m2027-1", "2027-01-31T15:00:00.000Z"],
    ["2028-02-27T15:00:00Z", "m2028-2", "2028-02-29T15:00:00.000Z"],
  ]) { const win = p.calendarWindow(Date.parse(iso)); assert.equal(win.key, key); assert.equal(win.end.toISOString(), end); }
});

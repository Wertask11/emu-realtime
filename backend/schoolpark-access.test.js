"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PASS_PREVIEW_AT, PUBLIC_AT, decideSchoolParkAccess } = require("./schoolpark-access");

test("September 20 permits owners only", () => {
  assert.equal(decideSchoolParkAccess(PASS_PREVIEW_AT - 1, {}).allowed, false);
  assert.equal(decideSchoolParkAccess(PASS_PREVIEW_AT - 1, { hasOfficialPass: true }).allowed, false);
  assert.equal(decideSchoolParkAccess(PASS_PREVIEW_AT - 1, { isOwner: true }).allowed, true);
});

test("September 21 JST starts official-pass preview", () => {
  assert.deepEqual(decideSchoolParkAccess(PASS_PREVIEW_AT, { hasOfficialPass: true }), {
    phase: "pass-preview", allowed: true
  });
  assert.equal(decideSchoolParkAccess(PASS_PREVIEW_AT, {}).allowed, false);
});

test("October 1 JST opens SchoolPark to everyone", () => {
  assert.deepEqual(decideSchoolParkAccess(PUBLIC_AT, {}), { phase: "public", allowed: true });
});

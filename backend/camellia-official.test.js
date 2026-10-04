"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateConsent, validateState, flattenState, CONSENT_VERSION } = require("./camellia");

test("requires the exact disclosure version and a valid acceptedAt", () => {
  assert.equal(validateConsent({ version: CONSENT_VERSION, acceptedAt: new Date().toISOString() }), true);
  assert.equal(validateConsent({ version: "old", acceptedAt: new Date().toISOString() }), false);
  assert.equal(validateConsent({ version: CONSENT_VERSION, acceptedAt: "invalid" }), false);
});

test("accepts only Camellia v3 state with a safe profile id", () => {
  const state = { version: 3, profile: { id: "profile_1" }, checkins: [] };
  assert.ok(validateState(state));
  assert.equal(validateState({ version: 2, profile: { id: "profile_1" } }), null);
  assert.equal(validateState({ version: 3, profile: { id: "bad/id" } }), null);
});

test("flattens conversations and tree reflections without dropping content", () => {
  const flat = flattenState({
    aiConversations: [{ id: "c1", createdAt: "a", updatedAt: "b", messages: [{ id: "m1", role: "user", text: "秘密" }] }],
    treeLeaves: [{ id: "l1", name: "人", reflections: [{ id: "r1", text: "メモ" }] }]
  });
  assert.equal(flat.aiMessages[0].text, "秘密");
  assert.equal(flat.aiMessages[0].conversationId, "c1");
  assert.equal(flat.treeReflections[0].text, "メモ");
  assert.equal(flat.treeReflections[0].leafId, "l1");
  assert.equal(flat.treeLeaves[0].reflections, undefined);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const { originAllowed } = require("./cors-policy");

test("our own pages can call the server", () => {
  for (const o of [
    "https://schoolpark-emu.vercel.app",
    "https://emu-for-schoolpark.vercel.app",
    "https://emu-realtime-qzrq-git-claude-loving-hamilton-3xb95f-school-park.vercel.app",
    "https://emu-realtime-qzrq-k8x9zmpow-school-park.vercel.app",
    "https://camellia-beta.vercel.app",
    "https://camellia-beta-git-feat-camellia-v1-release-audit-school-park.vercel.app",
    "https://school-park-homepage.vercel.app",
    "http://localhost:3000", "http://127.0.0.1:8931"
  ]) assert.equal(originAllowed(o, {}), true, o);
});

test("calls without an Origin (servers, webhooks) still pass", () => {
  assert.equal(originAllowed(undefined, {}), true);
  assert.equal(originAllowed("", {}), true);
});

test("other sites cannot use the server from a browser", () => {
  for (const o of [
    "https://evil.example", "https://schoolpark-emu.vercel.app.evil.example",
    "http://schoolpark-emu.vercel.app", "https://evil-schoolpark-emu.vercel.app",
    "https://emu-for-schoolpark.vercel.app.evil.example", "http://emu-for-schoolpark.vercel.app",
    "https://camellia-beta.vercel.app.evil.example", "null",
    "https://emu-realtime-evil.vercel.app", "https://emu-realtime-qzrq-x-other-team.vercel.app", "http://localhost.evil.example"
  ]) assert.equal(originAllowed(o, {}), false, o);
});

test("extra origins can be added without a code change", () => {
  assert.equal(originAllowed("https://partner.example", { CORS_EXTRA_ORIGINS: "https://a.example, https://partner.example/" }), true);
  assert.equal(originAllowed("https://other.example", { CORS_EXTRA_ORIGINS: "https://partner.example" }), false);
});

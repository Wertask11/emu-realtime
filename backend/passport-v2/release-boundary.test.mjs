import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
test("public RC excludes experimental WASM assets and does not grant WASM evaluation", () => {
  const root = new URL("../../frontend/", import.meta.url);
  for (const name of ["zkp-wallet.js", "zkp-wallet.js.LEGAL.txt"])
    assert.equal(
      existsSync(new URL("public/passport-v2/" + name, root)),
      false,
    );
  const vercel = JSON.parse(readFileSync(new URL("vercel.json", root), "utf8"));
  const text = JSON.stringify(
    vercel.headers.filter((x) => x.source.includes("passport-v2")),
  );
  assert.ok(!text.includes("wasm-unsafe-eval"));
  const html = readFileSync(
    new URL("public/passport-v2/index.html", root),
    "utf8",
  );
  assert.ok(!/posthog|client-errors|analytics\.js/i.test(html));
});

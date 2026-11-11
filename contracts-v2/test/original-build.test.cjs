"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const {
  verify,
  metadataTrailer,
} = require("../scripts/verify-original-build.cjs");
const root = path.resolve(__dirname, ".."),
  artifact = require("../artifacts/EMUERv2.json");
const sources = {
  "EMUERv2.sol": {
    content: fs.readFileSync(root + "/src/EMUERv2.sol", "utf8"),
  },
};
// Explicit inline snapshot of approved dependencies, not the verifier's import callback.
const solc = require("solc");
solc.compile(
  JSON.stringify({
    language: "Solidity",
    sources,
    settings: { outputSelection: { "*": { "*": ["abi"] } } },
  }),
  {
    import: (p) => {
      const content = fs.readFileSync(require.resolve(p), "utf8");
      sources[p] = { content };
      return { contents: content };
    },
  },
);
const input = {
  language: "Solidity",
  sources,
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "shanghai" },
};
let built;
test("deterministic original-input verifier requires full metadata AND ABI match", () => {
  const first = verify({
    input,
    deployedCode: "0x" + artifact.evm.deployedBytecode.object,
    expectedABI: artifact.abi,
  });
  built = first.compiledRuntime;
  const valid = verify({
    input,
    deployedCode: built,
    expectedABI: artifact.abi,
  }).report;
  assert.equal(valid.exactBuildMatches, true);
  assert.equal(valid.sourceHashesMatchMetadata, true);
  assert(valid.deployedMetadataCID.startsWith("Qm"));
});
test("metadata-only and ABI mismatch do not become an exact build pass", () => {
  const mutated =
    built.slice(0, -82) +
    (built.slice(-82, -80) === "aa" ? "bb" : "aa") +
    built.slice(-80);
  const r = verify({ input, deployedCode: mutated, expectedABI: [] }).report;
  assert.equal(r.exactBuildMatches, false);
  assert.equal(r.abiMatches, false);
  assert.equal(r.originalMetadataMatches, false);
  assert.equal(r.executableMatches, true);
});
test("unresolved imports, libraries, invalid metadata and corrupt runtime fail closed", () => {
  assert.throws(
    () =>
      verify({
        input: { ...input, sources: { "EMUERv2.sol": sources["EMUERv2.sol"] } },
        deployedCode: built,
        expectedABI: artifact.abi,
      }),
    /BUILD_FAILED/,
  );
  assert.throws(
    () =>
      verify({
        input: {
          ...input,
          settings: {
            ...input.settings,
            libraries: { x: { a: "0x" + "1".repeat(40) } },
          },
        },
        deployedCode: built,
      }),
    /EXTERNAL_LIBRARIES_NOT_APPROVED/,
  );
  assert.throws(() => metadataTrailer("0x1234"), /METADATA_LENGTH_INVALID/);
});

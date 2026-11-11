"use strict";
// Offline, deterministic comparison. Never sends transactions or changes flags.
const fs = require("node:fs"),
  solc = require("solc");
const ethers = require("../../backend/node_modules/ethers");
const {
  CHAIN_ID,
  TOKEN,
  TREASURY,
} = require("../../backend/economy/polygon-config");
function metadataTrailer(code) {
  if (!/^0x(?:[a-f0-9]{2})+$/i.test(code || ""))
    throw Error("RUNTIME_HEX_INVALID");
  const h = code.slice(2).toLowerCase(),
    bytes = parseInt(h.slice(-4), 16),
    start = h.length - 4 - bytes * 2;
  if (start < 0) throw Error("METADATA_LENGTH_INVALID");
  const trailer = h.slice(start, -4);
  const m = /^a2646970667358221220([a-f0-9]{64})64736f6c634300081b$/.exec(
    trailer,
  );
  if (!m) throw Error("METADATA_PROFILE_UNSUPPORTED");
  // The CID digest hashes a UnixFS/DAG-PB block, not raw metadata JSON.
  return {
    executable: h.slice(0, start),
    ipfsMultihashDigest: m[1],
    ipfsCID: ethers.utils.base58.encode(Buffer.from("1220" + m[1], "hex")),
  };
}
function short(s) {
  const b = Buffer.alloc(32),
    v = Buffer.from(s);
  v.copy(b);
  b[31] = v.length;
  return "0x" + b.toString("hex");
}
function verify({ input, deployedCode, expectedABI }) {
  if (!solc.version().startsWith("0.8.27+commit.40a35a09"))
    throw Error("COMPILER_VERSION_UNSUPPORTED");
  if (
    input.language !== "Solidity" ||
    !input.sources ||
    Object.keys(input.sources).length > 64
  )
    throw Error("STANDARD_INPUT_INVALID");
  const sources = Object.create(null);
  for (const [name, s] of Object.entries(input.sources)) {
    if (typeof s.content !== "string" || Buffer.byteLength(s.content) > 500000)
      throw Error("INLINE_SOURCES_REQUIRED");
    sources[name] = {
      keccak256: ethers.utils.keccak256(ethers.utils.toUtf8Bytes(s.content)),
    };
  }
  if (Object.keys(input.settings?.libraries || {}).length)
    throw Error("EXTERNAL_LIBRARIES_NOT_APPROVED");
  const settings = {
    ...input.settings,
    outputSelection: {
      "*": {
        "*": ["abi", "metadata", "evm.bytecode", "evm.deployedBytecode"],
        "": ["ast"],
      },
    },
  };
  // No import callback, remote fetches, or arbitrary filesystem reads.
  const output = JSON.parse(
    solc.compile(JSON.stringify({ ...input, settings })),
  );
  if (output.errors?.some((x) => x.severity === "error"))
    throw Error("BUILD_FAILED");
  const targets = Object.values(output.contracts || {}).flatMap((c) =>
    Object.entries(c)
      .filter(([name]) => name === "EMUERv2")
      .map(([, v]) => v),
  );
  if (targets.length !== 1) throw Error("TARGET_CONTRACT_AMBIGUOUS");
  const c = targets[0],
    definitions = Object.create(null);
  function walk(x) {
    if (!x || typeof x !== "object") return;
    if (x.nodeType === "VariableDeclaration" && x.mutability === "immutable")
      definitions[x.id] = x.name;
    for (const v of Object.values(x))
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") walk(v);
  }
  Object.values(output.sources).forEach((s) => walk(s.ast));
  const values = {
    treasury: TREASURY,
    _cachedThis: TOKEN,
    _cachedChainId: CHAIN_ID,
    _hashedName: ethers.utils.id("Emuer"),
    _hashedVersion: ethers.utils.id("2"),
    _cachedDomainSeparator: ethers.utils._TypedDataEncoder.hashDomain({
      name: "Emuer",
      version: "2",
      chainId: CHAIN_ID,
      verifyingContract: TOKEN,
    }),
    _name: short("Emuer"),
    _version: short("2"),
  };
  let patched = c.evm.deployedBytecode.object;
  for (const [id, refs] of Object.entries(
    c.evm.deployedBytecode.immutableReferences || {},
  )) {
    if (!(definitions[id] in values)) throw Error("IMMUTABLE_UNEXPLAINED");
    const word = ethers.utils
      .hexZeroPad(
        ethers.BigNumber.from(values[definitions[id]]).toHexString(),
        32,
      )
      .slice(2)
      .toLowerCase();
    for (const p of refs) {
      if (p.length !== 32) throw Error("IMMUTABLE_SIZE_INVALID");
      patched =
        patched.slice(0, p.start * 2) +
        word +
        patched.slice((p.start + 32) * 2);
    }
  }
  const built = "0x" + patched,
    live = metadataTrailer(deployedCode),
    local = metadataTrailer(built);
  const compilerMetadata = JSON.parse(c.metadata);
  const sourceHashesMatchMetadata = Object.entries(
    compilerMetadata.sources,
  ).every(([name, value]) => sources[name]?.keccak256 === value.keccak256);
  const canonical = (x) =>
    JSON.stringify(
      Array.isArray(x)
        ? x.map((v) => JSON.parse(canonical(v)))
        : x && typeof x === "object"
          ? Object.fromEntries(
              Object.keys(x)
                .sort()
                .map((k) => [k, JSON.parse(canonical(x[k]))]),
            )
          : x,
    );
  const report = {
    mode: "offline comparison; RPC provenance must be verified separately",
    compiler: solc.version(),
    optimizer: input.settings?.optimizer,
    evmVersion: input.settings?.evmVersion,
    chainId: CHAIN_ID,
    contract: TOKEN,
    treasury: TREASURY,
    sourceHashes: sources,
    externalLibraries: c.evm.deployedBytecode.linkReferences,
    deployedCodeHash: ethers.utils.keccak256(deployedCode),
    compiledCodeHash: ethers.utils.keccak256(built),
    executableMatches: live.executable === local.executable,
    fullRuntimeMatches: built.toLowerCase() === deployedCode.toLowerCase(),
    abiMatches: !!expectedABI && canonical(c.abi) === canonical(expectedABI),
    sourceHashesMatchMetadata,
    originalMetadataMatches:
      local.ipfsMultihashDigest === live.ipfsMultihashDigest,
    deployedMetadataCID: live.ipfsCID,
  };
  report.exactBuildMatches =
    report.fullRuntimeMatches &&
    report.abiMatches &&
    report.sourceHashesMatchMetadata &&
    report.originalMetadataMatches;
  return { report, compiledRuntime: built };
}
module.exports = { verify, metadataTrailer };
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 3)
      throw Error("USAGE_STANDARD_INPUT_RUNTIME_ABI_FILES_REQUIRED");
    const read = (p) => {
      if (fs.statSync(p).size > 5000000) throw Error("INPUT_SIZE_LIMIT");
      return fs.readFileSync(p, "utf8");
    };
    const result = verify({
      input: JSON.parse(read(args[0])),
      deployedCode: read(args[1]).trim(),
      expectedABI: JSON.parse(read(args[2])),
    });
    process.stdout.write(JSON.stringify(result.report, null, 2) + "\n");
    if (!result.report.exactBuildMatches) process.exitCode = 2;
  } catch (e) {
    process.stderr.write(
      JSON.stringify({
        error: /^[A-Z_]+$/.test(e.message)
          ? e.message
          : "BUILD_VERIFICATION_FAILED",
      }) + "\n",
    );
    process.exitCode = 1;
  }
}

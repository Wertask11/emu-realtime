// Synthetic-only minimal upstream reproduction. Does not print a credential/proof.
import dock from "../../backend/node_modules/@docknetwork/crypto-wasm-ts/lib/index.js";
import { sandboxZkpIssuer } from "../../backend/passport-v2/zkp-issuer.mjs";
import {
  generateZkp,
  verifyZkp,
} from "../../backend/passport-v2/zkp-proof.mjs";
const issuer = await sandboxZkpIssuer(),
  id = await issuer.issueTest();
const now = Date.now(),
  request = {
    useCase: "city",
    client_id: "https://verifier.example",
    nonce: "synthetic-reproduction-nonce-0000000000",
    asOf: now,
    expires: now + 300000,
  };
const proof = await generateZkp(await issuer.bundle(id), request),
  bytes = dock.Presentation.fromJSON(proof).proof.bytes;
const cases = [
  ["original", (b) => b],
  ["append-zero", (b) => Uint8Array.from([...b, 0])],
  ["append-nonzero", (b) => Uint8Array.from([...b, 42, 255])],
  ["append-32", (b) => Uint8Array.from([...b, ...new Uint8Array(32)])],
  ["truncate-1", (b) => b.slice(0, -1)],
  ["truncate-16", (b) => b.slice(0, -16)],
  ["prefix-zero", (b) => Uint8Array.from([0, ...b])],
  [
    "core-bit",
    (b) => {
      b[Math.floor(b.length / 2)] ^= 1;
      return b;
    },
  ],
  [
    "tail-bit",
    (b) => {
      b[b.length - 1] ^= 1;
      return b;
    },
  ],
];
const result = {
  library: "crypto-wasm-ts 0.67.0 / WASM 0.33.0",
  synthetic: true,
  byteLength: bytes.length,
  cases: [],
};
for (const [name, mutate] of cases) {
  const p = dock.Presentation.fromJSON(proof);
  p.proof.value = mutate(Uint8Array.from(bytes));
  let accepted = false;
  try {
    accepted = (
      await verifyZkp(p.toJSON(), { request, publicData: issuer.publicData() })
    ).verified;
  } catch (_) {}
  result.cases.push({ name, accepted });
}
for (const [name, value] of [
  ["whitespace", proof.proof + " "],
  ["invalid-base58", "0" + proof.proof],
  ["empty", ""],
]) {
  let accepted = false;
  try {
    accepted = (
      await verifyZkp(
        { ...proof, proof: value },
        { request, publicData: issuer.publicData() },
      )
    ).verified;
  } catch (_) {}
  result.cases.push({ name, accepted });
}
console.log(JSON.stringify(result, null, 2));

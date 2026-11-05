// Independent process / direct published library API. No issuer secret or holder witness.
const d = require("../../backend/node_modules/@docknetwork/crypto-wasm-ts");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (s) => {
  input += s;
  if (input.length > 200000) process.exit(2);
});
process.stdin.on("end", async () => {
  try {
    await d.initializeWasm();
    const { presentation, publicData, context } = JSON.parse(input),
      p = d.Presentation.fromJSON(presentation);
    if (p.context !== context) throw Error();
    const range = new d.BoundCheckBppParams(
      new TextEncoder().encode("SchoolPark Bulletproofs++ experimental v1"),
    ).decompress();
    const r = p.verify(
      [new d.BBSPlusPublicKeyG2(new Uint8Array(publicData.issuerKey))],
      new Map([
        [
          0,
          new d.AccumulatorPublicKey(new Uint8Array(publicData.accumulatorKey)),
        ],
      ]),
      new Map([["range-v1", range]]),
    );
    if (!r.verified) throw Error();
    process.stdout.write("VERIFIED");
  } catch (_) {
    process.stdout.write("REJECTED");
    process.exitCode = 1;
  }
});

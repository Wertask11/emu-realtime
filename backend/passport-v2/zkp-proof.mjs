// Experimental Dock anonymous-credential profile. Not an OpenID or W3C BBS cryptosuite identifier.
import dock from "@docknetwork/crypto-wasm-ts";
const {
  initializeWasm,
  PresentationBuilder,
  Presentation,
  BBSPlusCredential,
  VBMembershipWitness,
  AccumulatorPublicKey,
  BBSPlusPublicKeyG2,
  BoundCheckBppParams,
} = dock;
let ready;
const bytes = (s) => new TextEncoder().encode(s);
const eq = (a, b) => a?.length === b?.length && a.every((x, i) => x === b[i]);
export const ZKP_PROFILE = "schoolpark-bbs-plus-bpp-experimental-v1";
export async function zkpReady() {
  return (ready ||= initializeWasm());
}
export const zkpError = () => {
  throw Object.assign(new Error("ZKP_REJECTED"), { code: "ZKP_REJECTED" });
};
export function proofPolicy(request) {
  if (
    !["age18", "identity", "city"].includes(request.useCase) ||
    typeof request.nonce !== "string" ||
    !/^[-\w]{32,64}$/.test(request.nonce) ||
    typeof request.client_id !== "string" ||
    request.client_id.length > 512 ||
    !Number.isFinite(request.asOf) ||
    !Number.isFinite(request.expires) ||
    request.expires <= Date.now() ||
    request.expires - request.asOf > 300000 ||
    Math.abs(Date.now() - request.asOf) > 300000
  )
    zkpError();
  const now = Math.floor(request.asOf / 1000),
    date = new Date(request.asOf);
  date.setUTCFullYear(date.getUTCFullYear() - 18);
  const cutoff = Math.floor(
    (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) -
      Date.UTC(1900, 0, 1)) /
      86400000,
  );
  const bounds = {
    validFrom: [
      { min: 0, max: now + 1, paramId: "range-v1", protocol: "Bulletproofs++" },
    ],
    validUntil: [
      {
        min: now + 1,
        max: 4294967295,
        paramId: "range-v1",
        protocol: "Bulletproofs++",
      },
    ],
  };
  bounds[
    request.useCase === "age18"
      ? "birthDay"
      : request.useCase === "identity"
        ? "verified"
        : "shop"
  ] = [
    {
      min: request.useCase === "age18" ? 0 : 1,
      max: request.useCase === "age18" ? cutoff + 1 : 2,
      paramId: "range-v1",
      protocol: "Bulletproofs++",
    },
  ];
  return {
    bounds: { credentialSubject: bounds },
    context: JSON.stringify({
      profile: ZKP_PROFILE,
      audience: request.client_id,
      nonce: request.nonce,
      useCase: request.useCase,
      asOf: request.asOf,
      expires: request.expires,
    }),
  };
}
const normalized = (o) =>
  Array.isArray(o)
    ? o.map(normalized)
    : o && typeof o === "object"
      ? Object.fromEntries(
          Object.keys(o)
            .sort()
            .map((k) => [k, normalized(o[k])]),
        )
      : o;
const same = (a, b) =>
  JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));
const rangeParams = () =>
  new BoundCheckBppParams(
    bytes("SchoolPark Bulletproofs++ experimental v1"),
  ).decompress();
export async function generateZkp(bundle, request) {
  try {
    await zkpReady();
    const policy = proofPolicy(request),
      credential = BBSPlusCredential.fromJSON(bundle.credential),
      b = new PresentationBuilder();
    b.addCredential(credential);
    b.context = policy.context;
    b.nonce = bytes(request.nonce);
    const bp = rangeParams();
    let first = true;
    for (const [name, [bound]] of Object.entries(
      policy.bounds.credentialSubject,
    )) {
      b.enforceBounds(
        0,
        "credentialSubject." + name,
        bound.min,
        bound.max,
        "range-v1",
        first ? bp : undefined,
      );
      first = false;
    }
    b.addAccumInfoForCredStatus(
      0,
      new VBMembershipWitness(new Uint8Array(bundle.witness)),
      new Uint8Array(bundle.accumulated),
      new AccumulatorPublicKey(new Uint8Array(bundle.accumulatorKey)),
      {},
    );
    return b.finalize().toJSON();
  } catch (_) {
    zkpError();
  }
}
export async function verifyZkp(encoded, { request, publicData }) {
  try {
    await zkpReady();
    if (JSON.stringify(encoded).length > 150000) zkpError();
    const policy = proofPolicy(request);
    if (
      !encoded?.spec ||
      Object.keys(encoded).some(
        (k) => !["version", "context", "nonce", "spec", "proof"].includes(k),
      ) ||
      Object.keys(encoded.spec).some(
        (k) =>
          ![
            "credentials",
            "attributeEqualities",
            "boundedPseudonyms",
            "unboundedPseudonyms",
          ].includes(k),
      ) ||
      !same(encoded.spec.attributeEqualities, []) ||
      !same(encoded.spec.boundedPseudonyms, {}) ||
      !same(encoded.spec.unboundedPseudonyms, {})
    )
      zkpError();
    const p = Presentation.fromJSON(encoded),
      c = p.spec.credentials[0];
    if (
      !c ||
      Object.keys(c).some(
        (k) =>
          ![
            "version",
            "schema",
            "sigType",
            "revealedAttributes",
            "status",
            "bounds",
          ].includes(k),
      ) ||
      c.status?.type !== "DockVBAccumulator2022" ||
      !same(c.status.extra, {})
    )
      zkpError();
    if (
      p.context !== policy.context ||
      !eq(p.nonce, bytes(request.nonce)) ||
      p.spec.credentials.length !== 1 ||
      JSON.stringify(c.revealedAttributes) !== "{}" ||
      !same(c.bounds, policy.bounds) ||
      !same(c.schema, publicData.schema) ||
      c.status?.id !== publicData.registryId ||
      c.status?.revocationCheck !== "membership" ||
      !eq(c.status?.accumulated, new Uint8Array(publicData.accumulated))
    )
      zkpError();
    const result = p.verify(
      [new BBSPlusPublicKeyG2(new Uint8Array(publicData.issuerKey))],
      new Map([
        [
          0,
          new AccumulatorPublicKey(new Uint8Array(publicData.accumulatorKey)),
        ],
      ]),
      new Map([["range-v1", rangeParams()]]),
    );
    if (!result.verified) zkpError();
    return {
      verified: true,
      useCase: request.useCase,
      profile: ZKP_PROFILE,
      testOnly: true,
    };
  } catch (_) {
    zkpError();
  }
}

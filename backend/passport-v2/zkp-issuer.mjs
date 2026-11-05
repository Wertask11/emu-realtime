import dock from "@docknetwork/crypto-wasm-ts";
import memory from "@docknetwork/crypto-wasm-ts/lib/accumulator/in-memory-persistence.js";
import { randomUUID } from "node:crypto";
import { zkpReady, zkpError } from "./zkp-proof.mjs";
const {
  CredentialSchema,
  BBSPlusCredentialBuilder,
  BBSPlusSignatureParamsG1,
  BBSPlusKeypairG2,
  dockAccumulatorParams,
  PositiveAccumulator,
  MEM_CHECK_STR,
} = dock;
// TEST issuer only. No KYC/adult declaration/City rights is read or converted into an assertion.
export async function sandboxZkpIssuer() {
  await zkpReady();
  const schema = CredentialSchema.essential();
  schema.properties.credentialSubject = {
    type: "object",
    properties: {
      birthDay: { type: "integer", minimum: 0 },
      verified: { type: "integer", minimum: 0 },
      shop: { type: "integer", minimum: 0 },
      validFrom: { type: "integer", minimum: 0 },
      validUntil: { type: "integer", minimum: 0 },
      name: { type: "string" },
      address: { type: "string" },
      holderSecret: { type: "string" },
    },
  };
  schema.properties.credentialStatus = CredentialSchema.statusAsJsonSchema();
  const kp = BBSPlusKeypairG2.generate(
      BBSPlusSignatureParamsG1.generate(
        100,
        new TextEncoder().encode("DockBBS+Signature2022"),
      ),
    ),
    ap = dockAccumulatorParams(),
    ak = PositiveAccumulator.generateKeypair(ap),
    acc = PositiveAccumulator.initialize(ap),
    state = new memory.InMemoryState(),
    records = new Map(),
    registryId = "SchoolPark-shared-test-registry-v1";
  let publicSchema;
  return {
    async issueTest({
      birthDay = 36524,
      verified = 1,
      shop = 1,
      validFrom = 0,
      validUntil = 4000000000,
    } = {}) {
      const id = randomUUID(),
        revId = randomUUID(),
        b = new BBSPlusCredentialBuilder();
      b.schema = new CredentialSchema(schema);
      b.subject = {
        birthDay,
        verified,
        shop,
        validFrom,
        validUntil,
        name: "SYNTHETIC TEST PERSON",
        address: "SYNTHETIC TEST ADDRESS",
        holderSecret: randomUUID(),
      };
      b.setCredentialStatus(registryId, MEM_CHECK_STR, revId);
      const c = b.sign(kp.sk),
        member = c.schema.encoder.encodeMessage(
          "credentialStatus.revocationId",
          revId,
        );
      await acc.add(member, ak.sk, state);
      records.set(id, { c, member, revoked: false });
      publicSchema = c.schema.toJSON();
      return id;
    },
    async bundle(id) {
      const r = records.get(id);
      if (!r || r.revoked) zkpError();
      const w = await acc.membershipWitness(r.member, ak.sk, state);
      return {
        credential: r.c.toJSON(),
        witness: Array.from(w.value),
        accumulated: Array.from(acc.accumulated),
        accumulatorKey: Array.from(ak.pk.value),
        testOnly: true,
      };
    },
    async revoke(id) {
      const r = records.get(id);
      if (!r || r.revoked) zkpError();
      await acc.remove(r.member, ak.sk, state);
      r.revoked = true;
    },
    publicData() {
      return {
        issuerKey: Array.from(kp.pk.value),
        accumulatorKey: Array.from(ak.pk.value),
        accumulated: Array.from(acc.accumulated),
        registryId,
        schema: publicSchema,
        testOnly: true,
      };
    },
    schemaFor(id) {
      const r = records.get(id);
      return r.c.schema.toJSON();
    },
  };
}

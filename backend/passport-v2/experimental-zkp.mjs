import { randomBytes, createHash } from "node:crypto";
import { sandboxZkpIssuer } from "./zkp-issuer.mjs";
import { verifyZkp, zkpError, ZKP_PROFILE } from "./zkp-proof.mjs";
const hash = (s) => createHash("sha256").update(s).digest("hex");
const nonce = () => randomBytes(32).toString("base64url");
export async function zkpSandbox({ store, base, clock = Date.now }) {
  const issuer = await sandboxZkpIssuer(),
    epoch = nonce();
  return {
    async sample(owner, useCase) {
      if (!["age18", "identity", "city"].includes(useCase)) zkpError();
      await store.run(owner, (a, s) => {
        if (a.zkpEpoch !== epoch) {
          a.zkpCredentials = [];
          a.zkpReservations = 0;
          a.zkpEpoch = epoch;
        }
        a.zkpCredentials ||= [];
        a.zkpReservations ||= 0;
        s.zkpIssued ||= 0;
        if (
          a.zkpCredentials.length + a.zkpReservations >= 3 ||
          s.zkpIssued >= 256
        )
          zkpError();
        a.zkpReservations++;
        s.zkpIssued++;
      });
      const id = await issuer.issueTest();
      await store.run(owner, (a) => {
        a.zkpReservations--;
        a.zkpCredentials.push({ id, useCase });
      });
      return { id, useCase, testOnly: true, profile: ZKP_PROFILE };
    },
    async request(owner, id) {
      const meta = await store.run(owner, (a) =>
        a.zkpCredentials?.find((c) => c.id === id),
      );
      if (!meta) zkpError();
      const now = clock(),
        r = {
          id: nonce(),
          nonce: nonce(),
          client_id: base,
          useCase: meta.useCase,
          credentialId: id,
          asOf: now,
          expires: now + 300000,
          status: "pending",
          recipient: "この開発環境の検証先（実在事業者の認証ではありません）",
          purpose: "架空資格による述語証明の検証",
          testOnly: true,
        };
      await store.ticket(hash(r.id), () => ({
        next: { ...r, owner },
        result: true,
      }));
      return { ...r, bundle: await issuer.bundle(id) };
    },
    async consent(owner, id, approved) {
      if (typeof approved !== "boolean") zkpError();
      return store.ticket(hash(id), (r) => {
        if (
          !r ||
          r.owner !== owner ||
          r.expires <= clock() ||
          r.status !== "pending"
        )
          zkpError();
        r.status = approved ? "approved" : "denied";
        return { next: r, result: { status: r.status } };
      });
    },
    async receive(owner, id, presentation) {
      const r = await store.ticket(hash(id), (r) => {
        if (
          !r ||
          r.owner !== owner ||
          r.expires <= clock() ||
          r.status !== "approved"
        )
          zkpError();
        return { next: r, result: r };
      });
      await verifyZkp(presentation, {
        request: r,
        publicData: issuer.publicData(),
      });
      return store.ticket(hash(id), (r) => {
        if (
          !r ||
          r.owner !== owner ||
          r.status !== "approved" ||
          r.expires <= clock()
        )
          zkpError();
        r.status = "consumed";
        return {
          next: r,
          result: { verified: true, testOnly: true, profile: ZKP_PROFILE },
        };
      });
    },
    async revoke(owner, id) {
      const found = await store.run(owner, (a) =>
        a.zkpCredentials?.some((c) => c.id === id),
      );
      if (!found) zkpError();
      await issuer.revoke(id);
      return { revoked: true, testOnly: true };
    },
  };
}

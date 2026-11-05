// Isolated tests only; never imported by application bootstrap.
import formatter from "ecdsa-sig-formatter";
export function testDatabase() {
  const rows = new Map();
  let queue = Promise.resolve();
  const snap = (ref) => ({
    exists: rows.has(ref.path),
    data: () => structuredClone(rows.get(ref.path)),
  });
  const doc = (path) => ({ path, get: async () => snap({ path }) });
  return {
    rows,
    collection(name) {
      return {
        doc: (id) => doc(name + "/" + id),
        add: async (data) =>
          rows.set(name + "/" + crypto.randomUUID(), structuredClone(data)),
      };
    },
    runTransaction(fn) {
      const p = queue.then(async () => {
        const writes = [];
        const r = await fn({
          get: async (ref) => snap(ref),
          set: (ref, data) =>
            writes.push(() => rows.set(ref.path, structuredClone(data))),
          delete: (ref) => writes.push(() => rows.delete(ref.path)),
        });
        writes.forEach((w) => w());
        return r;
      });
      queue = p.catch(() => {});
      return p;
    },
  };
}
export async function testKms(key, arn) {
  let outage = false;
  return {
    setOutage: (v) => (outage = v),
    async send(c) {
      if (outage) throw Error("sensitive upstream transport failure");
      if (c.constructor.name === "DescribeKeyCommand")
        return {
          KeyMetadata: {
            Arn: arn,
            KeyState: "Enabled",
            KeyUsage: "SIGN_VERIFY",
            KeySpec: "ECC_NIST_P256",
            Origin: "AWS_KMS",
          },
        };
      if (c.constructor.name === "GetPublicKeyCommand")
        return {
          KeyId: arn,
          KeyUsage: "SIGN_VERIFY",
          KeySpec: "ECC_NIST_P256",
          SigningAlgorithms: ["ECDSA_SHA_256"],
          PublicKey: new Uint8Array(
            await crypto.subtle.exportKey(
              "spki",
              await crypto.subtle.importKey(
                "jwk",
                key.jwk,
                { name: "ECDSA", namedCurve: "P-256" },
                true,
                ["verify"],
              ),
            ),
          ),
        };
      const s = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        key.privateKey,
        c.input.Message,
      );
      return {
        KeyId: arn,
        SigningAlgorithm: "ECDSA_SHA_256",
        Signature: formatter.joseToDer(
          Buffer.from(s).toString("base64url"),
          "ES256",
        ),
      };
    },
  };
}

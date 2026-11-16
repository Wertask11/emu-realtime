"use strict";
// Opt-in isolated-key acceptance. No RPC provider/broadcast and no production key.
const ethers = require("ethers");
const { createKMSSigner } = require("./kms");
const { workloadIdentity } = require("./identity");
function configuration(env, approveSign) {
  if (
    !env.POLYGON_KMS_TEST_APPROVAL_REF ||
    env.POLYGON_KMS_ISOLATED_TEST_KEY !== "true" ||
    !env.POLYGON_KMS_TEST_KEY_ARN ||
    !env.POLYGON_KMS_TEST_ADDRESS ||
    !env.POLYGON_KMS_KEY_ARN ||
    env.POLYGON_KMS_TEST_KEY_ARN === env.POLYGON_KMS_KEY_ARN ||
    env.POLYGON_KMS_TEST_ADDRESS.toLowerCase() === env.ECONOMY_POLYGON_OPERATOR_ADDRESS?.toLowerCase()
  ) throw Error("APPROVED_ISOLATED_TEST_KEY_REQUIRED");
  if (approveSign && env.POLYGON_KMS_TEST_SIGN_APPROVED !== "true")
    throw Error("TEST_SIGNATURE_APPROVAL_REQUIRED");
  return { keyId: env.POLYGON_KMS_TEST_KEY_ARN, address: env.POLYGON_KMS_TEST_ADDRESS };
}
async function accept({ env, approveSign = false, client }) {
  const config = configuration(env, approveSign);
  const signer = createKMSSigner({ ...config, client });
  await signer.validate();
  const result = { scope: "isolated-KMS-key", publicKeyValidated: true, signatureValidated: false, broadcasts: 0, productionTransactions: 0 };
  if (approveSign) {
    // Deliberately below intrinsic gas: these bytes cannot execute on Polygon.
    const tx = { chainId:137, to:"0x9c102cC3016C70767082b60196565878D9314864", nonce:0, value:0, gasLimit:1, gasPrice:1, data:"0x" };
    const raw = await signer.signTransaction(tx), p = ethers.utils.parseTransaction(raw);
    if (p.from !== ethers.utils.getAddress(config.address) || p.chainId !== 137 || p.to !== tx.to || !p.gasLimit.eq(1) || !p.value.isZero())
      throw Error("ISOLATED_SIGNATURE_VERIFICATION_FAILED");
    result.signatureValidated = true;
  }
  return result; // Never return raw signed bytes, tokens or credential objects.
}
if (require.main === module) {
  (async () => {
    const env = process.env, approveSign = process.argv.includes("--approved-sign-test");
    configuration(env, approveSign); // Fail before any credential or network request.
    const credentials = workloadIdentity(env);
    const { KMSClient } = require("@aws-sdk/client-kms");
    console.log(JSON.stringify(await accept({ env, approveSign, client:new KMSClient({ region:env.AWS_REGION,credentials,maxAttempts:1 }) })));
  })().catch(e => { console.error(JSON.stringify({ state:"NOT_COMPLETED",error:/^[A-Z_]+$/.test(e.message)?e.message:"LIVE_KMS_ACCEPTANCE_FAILED",productionTransactions:0 }));process.exitCode=1; });
}
module.exports = { configuration, accept };

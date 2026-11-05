import { KMSClient } from "@aws-sdk/client-kms";
import { fromTokenFile } from "@aws-sdk/credential-provider-web-identity";
import { isAbsolute } from "node:path";
import { fail } from "./crypto.mjs";

// Explicit workload federation only: no static access-key/env credential fallback,
// custom STS/KMS endpoints or plaintext issuer key. No credential file is logged.
export function workloadKmsClient({ region, roleArn, tokenFile }) {
  if (
    !/^[a-z]{2}(-[a-z]+)+-\d$/.test(region || "") ||
    !/^arn:aws:iam::\d{12}:role\/[\w+=,.@/-]+$/.test(roleArn || "") ||
    typeof tokenFile !== "string" ||
    !isAbsolute(tokenFile)
  )
    fail("WORKLOAD_IDENTITY_REQUIRED");
  return new KMSClient({
    region,
    endpoint: "https://kms." + region + ".amazonaws.com",
    credentials: fromTokenFile({
      roleArn,
      webIdentityTokenFile: tokenFile,
      roleSessionName: "schoolpark-passport-issuer",
      clientConfig: {
        region,
        endpoint: "https://sts." + region + ".amazonaws.com",
      },
    }),
    maxAttempts: 2,
  });
}

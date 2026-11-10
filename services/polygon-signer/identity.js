"use strict";
const { fromTokenFile } = require("@aws-sdk/credential-provider-web-identity");
const {
  fromContainerMetadata,
  fromInstanceMetadata,
} = require("@smithy/credential-provider-imds");
// Explicit provider selection; never fall through to ~/.aws or static env keys.
function workloadIdentity(env) {
  if (
    env.AWS_ACCESS_KEY_ID ||
    env.AWS_SECRET_ACCESS_KEY ||
    env.AWS_SESSION_TOKEN ||
    env.AWS_PROFILE ||
    env.AWS_SHARED_CREDENTIALS_FILE
  )
    throw Error("WORKLOAD_IDENTITY_REQUIRED");
  switch (env.POLYGON_AWS_IDENTITY_MODE) {
    case "web-identity":
      if (!env.AWS_ROLE_ARN || !env.AWS_WEB_IDENTITY_TOKEN_FILE) break;
      return fromTokenFile({
        roleArn: env.AWS_ROLE_ARN,
        webIdentityTokenFile: env.AWS_WEB_IDENTITY_TOKEN_FILE,
      });
    case "container":
      if (
        !env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI &&
        !env.AWS_CONTAINER_CREDENTIALS_FULL_URI
      )
        break;
      return fromContainerMetadata({ timeout: 2000, maxRetries: 1 });
    case "instance-role":
      return fromInstanceMetadata({ timeout: 2000, maxRetries: 1 });
  }
  throw Error("WORKLOAD_IDENTITY_REQUIRED");
}
module.exports = { workloadIdentity };

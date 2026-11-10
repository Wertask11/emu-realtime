"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { workloadIdentity } = require("./identity");
test("only explicit workload providers, never credential chain or static profiles", () => {
  assert.throws(() => workloadIdentity({}), /WORKLOAD_IDENTITY_REQUIRED/);
  assert.throws(
    () => workloadIdentity({ POLYGON_AWS_IDENTITY_MODE: "web-identity" }),
    /WORKLOAD_IDENTITY_REQUIRED/,
  );
  for (const key of [
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_PROFILE",
    "AWS_SHARED_CREDENTIALS_FILE",
  ])
    assert.throws(
      () =>
        workloadIdentity({
          POLYGON_AWS_IDENTITY_MODE: "instance-role",
          [key]: "synthetic-test-value",
        }),
      /WORKLOAD_IDENTITY_REQUIRED/,
    );
  for (const env of [
    { POLYGON_AWS_IDENTITY_MODE: "instance-role" },
    {
      POLYGON_AWS_IDENTITY_MODE: "web-identity",
      AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/signer",
      AWS_WEB_IDENTITY_TOKEN_FILE: "/tmp/not-read-test-token",
    },
    {
      POLYGON_AWS_IDENTITY_MODE: "container",
      AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/test",
    },
  ])
    assert.equal(typeof workloadIdentity(env), "function"); // Providers are not invoked; no metadata/AWS access.
});

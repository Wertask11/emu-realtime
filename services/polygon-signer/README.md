# Private Polygon operator

Default OFF. Not mounted in the Emu backend or Vercel frontend. No raw keys.

Read [release/operations/audit requirements](../../docs/economy/phase5-operator-release.md)
before provisioning. A new AWS key/service, role grant, POL funding, and live
transaction require separate Founder approval. `REFUND_ROLE` remains global.

```
npm ci --ignore-scripts
npm test
```

Tests use synthetic local keys and an AWS SDK double, not a real AWS account.
`node server.js` fails closed unless the explicit workload identity and all
configuration described in the report are provided. Bind is loopback; expose
only through authenticated private TLS ingress, never a public unauthenticated
signing endpoint. Bearer token must have at least 32 characters.

`GET /ready`: authenticated read-only key/chain/role readiness.
`POST /sign`: authenticated v1 durable operation request with 60-second expiry.
Only the existing service's refundExchange/markExchangeFulfilled can be signed.
No endpoint accepts an arbitrary digest. Returned signed bytes are persisted;
application/operator broadcasts the exact bytes and verifies finalized receipts.

IAM example is a template, not an applied policy. Do not grant KMS administration
or generic signing access to the application. Firestore ADC requires a separate
least-privilege workload identity. Firestore server IAM bypasses client Rules;
collection ownership checks in this service are defense in depth, not on-chain
order-scoped authorization. Signature/nonce financial audit retention must be
approved before live service; no automatic deletion of unsettled records.

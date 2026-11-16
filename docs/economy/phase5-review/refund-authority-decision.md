# REFUND_ROLE: limits, maximum impact and approval decision

Status 2026-11-16: Polygon OFF. Existing token unchanged. No role grant, adapter deployment or production signature.

## Facts from deployed-compatible source / chain

`refundExchange(bytes32)` and `markExchangeFulfilled(bytes32)` both require the **same global REFUND_ROLE**. No per-product role, delegation registry, per-order policy or caller-specific allowance exists. Refund pays exactly the recorded paid amount to the original buyer; no caller-selected recipient/amount. Fulfillment permanently releases that order's refund reserve. Both paths reject already settled orders. Token is a direct deployment, without an upgrade interface.

An EOA/KMS address with this role can call either method for any unsettled order, including City. IAM fixes key/algorithm/network, but cannot inspect Ethereum calldata, order ownership, amount or deadlines. A signer policy on the server checks these; it does **not** narrow the token role. Compromise of KMS Sign access bypassing that policy still reaches the global contract authority. Splitting two server URLs/keys alone does not separate the token's two methods either.

## Impact bound

The role alone cannot transfer an arbitrary treasury balance, choose a refund recipient, create an authorized exchange, increase supply, or change administrator. It can incorrectly refund outstanding orders (giving buyers service plus refunded tokens), or falsely fulfill orders and destroy refund entitlement. The token value exposed is bounded by the sum of unsettled orders at the incident time, **not** by the operator's 5 EMUER quote or off-chain daily budget. Repeated calls cannot settle an order twice. Future orders increase exposure until revocation/stop.

Read-only snapshot 2026-11-16 15:26 JST: `reservedForRefunds=15 EMUER`. This is the current global unsettled reserve, **not** a lifetime upper bound, total treasury balance, or a promise all reserves belong to this service. Gas loss is separately bounded by the funded operator POL and signed pending transaction authority; IAM/key takeover can bypass application spending caps. Never represent the app's 20/day limit as an on-chain loss limit.

## Existing-token options

1. Keep Polygon OFF and ledger active: no new on-chain authority. Current action.
2. Global EOA role + managed signer policy: possible without new contract, but retains the high-risk bypass above. Independent audit and explicit risk acceptance are required; it is not the completed on-chain isolation solution.
3. **Preferred design for Founder review: dedicated immutable adapter**, granted only the existing token's REFUND_ROLE. The token, supply, balances and existing City treasury/admin roles remain unchanged. No token reissue/migration is needed merely for metadata or this role boundary.

## Adapter design — not yet implemented or deployed

- Pin chain137/token/service product and exact5 amount; reject all other products (including City), wrong buyer and already settled orders by reading token.orders.
- An independent registrar enrolls each actual service order with buyer/product/amount, purpose/version, creation/authorization deadline and bounded enrollment period. A role-holding operator cannot enroll arbitrary orders. Enrollment refers to the existing orderId; no transfer/approve/claim ability.
- Separate on-chain REFUND_OPERATOR and FULFILL_OPERATOR. Refund path calls only refundExchange to original buyer. Fulfillment requires a separate attestor's order-specific completion authorization. The contract cannot itself prove a Firestore artifact exists; attestations remain a documented trust boundary.
- Enforce approved per-operation, daily and total enrollment/value caps in the adapter; no unbounded owner bypass. Refunds for already enrolled paid orders must remain possible after trial/enrollment expiry. Stop new enrollment/fulfillment separately from existing refunds.
- A new adapter is immutable; contract administrator can rotate/revoke operator or registrar and pause scope. Token administrator can revoke adapter REFUND_ROLE as the last resort, but that can stop refunds and must be handled as an incident.
- Loss bound becomes the allowed, unsettled adapter-enrolled service orders and approved contract caps; City orders are rejected on-chain. State exact caps only after Founder approval/audit, not the app's existing limits by assumption.

Needed approval before coding this contract: contract design/caps/trust principals; whether users accept completion attestation and refund terms; deployment/role grant/POL limits; independent audit/legal scope. The present task explicitly requires a design and approval before implementing a contract migration. Thus no new Solidity adapter, production grant or mainnet test is created here.

## Cutover and recovery preserving assets

Inventory old unsettled orders and signatures read-only. Stop only new wallet intake; keep ledger and existing refund reconciliation. Build/audit the approved adapter in isolation, estimate its actual deployment gas, then obtain a bounded deployment/grant approval. Existing token never moves. Test rejecting old City orders and wrong methods before enabling service enrollment. Keep old pending orders with their original authority until completion/refund and old signed nonces are resolved. No automatic re-enrollment of old data.

Emergency: stop intake and signing control, disable compromised KMS, reconcile already broadcast receipts/nonces, then separately approve role revocation/adapter pause where needed. KMS disable cannot cancel a previously broadcast transaction. Do not release POL holds while an old signed nonce can execute. Recovery uses approved new key/address and audited authority; no raw-key export or automatic gas bump. Adapter deployment cost remains unknown until its approved bytecode exists; do not invent a redeployment price.

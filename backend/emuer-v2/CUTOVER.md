# EMUER v2 cutover

The verified Polygon contract is `0x9c102cC3016C70767082b60196565878D9314864`.

Before 2026-10-01 00:00 JST, keep `EMUER_V2_ENABLED=false`.  The old system stays visible, but no v2 rewards, conversion, or exchange operation can begin.

At the start time:

1. Confirm `/api/emuer/v2/readiness` reports `authorizer.ok: true`, `active: true`, and the verified v2 address.
2. Run `node backend/emuer-v2/backfill-reactions.cjs` first. Review `emuer-v2-past-reactions.json`; only `ready` rows are eligible.
3. Run `node backend/emuer-v2/backfill-reactions.cjs --commit`. It is idempotent and records only historic Good and received Change. It writes no on-chain transaction.
4. Set `EMUER_V2_ENABLED=true` and redeploy Render.
5. Verify one Light conversion and one approved v2 reward claim using a testable operator account.

Required Render values:

- `EMUER_V2_AUTHORIZER_PRIVATE_KEY` (already configured)
- `POLYGON_RPC_URL` (recommended)
- `EMUER_V2_ENABLED=false` until the start time
- `EMUER_V2_OPERATOR_ADDRESSES` only when an operator wallet other than the treasury needs Guild/Quest approval

Conversion constraints are server-enforced: guest/free users cannot convert, Light is once per JST month, Plus once per JST week, Pro unlimited. The conversion counter is separate from the future exchange counter. It advances only after the v2 contract has confirmed payment; failed browser/MetaMask operations do not advance it.

Legacy contract conversion and legacy NFT purchase are disabled in the v2 UI. Do not add a v2 exchange product until its price, delivery condition, refund rule, and service/NFT record have been defined and an EIP-712 order endpoint is reviewed.

# Phase 0: City commerce safety and implementation preparation

Audit basis: repository main at `1c06d2beeea31fb7c73b1084feee359b1eb94f42` (2026-10-08). This document records source findings only. No Production Firebase, Firestore, Render, Vercel, Stripe, wallet, or token settings were read or changed.

## Current code changes in this branch

- EMUER v2 now requires `EMUER_V2_ENABLED=true`; missing, false, or malformed values keep v2 closed. `EMUER_V2_LAUNCH_HOLD=true` always closes it. An invalid non-empty hold value also closes it.
- The shared policy is used by the v2 gateway, Mitemiru (through its existing `emuerEnabled` dependency), and quest-completion approvals that issue EMUER rewards.
- JPYC, card, and cash Mitemiru methods are not gated by the EMUER v2 switch.
- Firebase Admin initialization validates staging project identity. `APP_ENV=staging` requires an explicit `FIREBASE_PROJECT_ID`, requires it to match the service-account project, and rejects the known Production project. Production keeps its current service-account project fallback and storage-bucket default.
- Tests cover the flag policy, staging project validation, quest reward rejection while held, and continued cash-order availability when EMUER is held.

The branch does not change Production environment variables or deployments.

## Staging separation: code and external setup

The backend guard is only one layer. The current frontend still has Production-bound configuration:

- `frontend/public/__/firebase/init.json` points at the Production Firebase project.
- `frontend/vercel.json` rewrites Firebase Auth and one SchoolPark API endpoint to Production.
- Multiple frontend modules contain the Production Render API URL.
- Firebase initialization is embedded in multiple pages, including administrative and Camellia-related surfaces.

Therefore a Vercel Preview from the Production project is **not safe for authenticated write testing**. The branch created for this Phase 0 work already received a successful Vercel status check; no authentication or write test was performed there. Until a separate client build and API are configured, disable Preview deployments or put them behind mandatory deployment protection and retire accessible Preview aliases. Do not log in or test writes from those previews.

Owner setup required before Staging integration tests:

1. Create a separate Firebase project for Staging. Enable only the needed Auth providers, create test-only users, apply Staging Firestore rules/indexes, and create a Staging-only service account.
2. Create a separate Render Staging service pointed at the Staging branch. Set:
   - `APP_ENV=staging`
   - `FIREBASE_PROJECT_ID` to the Staging Firebase project ID
   - `FIREBASE_STORAGE_BUCKET` to the Staging bucket
   - `FIREBASE_SERVICE_ACCOUNT` to the Staging-only service account JSON
   - `EMUER_V2_ENABLED=false` and `EMUER_V2_LAUNCH_HOLD=true` until the test exchange path is verified
   - Stripe test-mode credentials and a test-only webhook secret, if card-flow tests are later needed
3. Create a separate Vercel Staging project and domain. Configure its built Firebase client, Auth domain, API base URL, and Firebase Auth rewrites to point only to Staging. Do not reuse the Production `init.json` or Production Render URL.
4. Use synthetic Passport IDs, products, orders, inventory and ledger rows. Never import or copy Production users, orders, reward rows, wallet keys, or balances.
5. Keep `emuer_chain` disabled in end-to-end Staging until a test-chain deployment and environment-configurable contract addresses exist. Current Mitemiru and v2 code contains Polygon mainnet addresses. Unit tests use mocked chain data and do not send transactions.
6. Share only variable names and setup status in review. Do not paste secret values into PRs, logs, chat, or test output.

The current code supports checking the Staging Firebase project on backend startup. The frontend build/runtime split and external Firebase/Render/Vercel resources have not been configured, so Staging is **not READY for authenticated integration tests**.

## EMUER stop semantics

| Setting | Result |
|---|---|
| `EMUER_V2_ENABLED` absent, `false`, or malformed | EMUER v2 issuance/conversion/exchange is closed |
| `EMUER_V2_ENABLED=true` before the published start | Closed |
| `EMUER_V2_ENABLED=true` after start, hold absent or `false` | Open |
| `EMUER_V2_LAUNCH_HOLD=true` | Closed regardless of enable flag |
| `EMUER_V2_LAUNCH_HOLD` set to an unrecognized non-empty value | Closed |

The EMUER stop also blocks Mitemiru's two EMUER methods and quest-completion EMUER reward approval. Product browsing and JPYC/card/cash order paths remain available. It does not stop Stripe membership billing or non-EMUER records. Quest budget publication remains available; it does not itself issue a reward.

Before Production rollout, an operator must privately verify that Render's current `EMUER_V2_ENABLED` value is explicitly `true` and that the hold is absent or `false`. No Production setting was read or changed in this work.

## Mitemiru dependency map

| Capability | Existing source of truth / path | City migration constraint |
|---|---|---|
| Shops and products | `mitemiru_shops`, `mitemiru_products`; `GET /api/mitemiru/products` | City list and 3D storefront must reference the same product IDs; do not duplicate authoritative price or stock |
| Order creation and history | `mitemiru_orders`; `POST /api/mitemiru/orders`, user order/history routes | Keep existing schema readable; new City/event source and verified Passport ID should be additive |
| EMUER ledger | `emuer_v2_rewards`; successful spend marks reward used and creates change where applicable | Use only SchoolPark virtual stores and official events; preserve plan limits and transaction semantics |
| EMUER wallet exchange | Polygon `EMUERv2.exchange`; chain payment records and short-lived authorization | Current contracts are mainnet-bound; no Staging wallet or mainnet transaction tests |
| JPYC | Polygon transfer verification; two confirmations; configured receiver with a treasury fallback | This path is not Reji integration and must not be used for the real-partner City flow until reviewed |
| Stripe | `jpy_card`; shared `/api/billing/webhook` with membership billing | Preserve the shared webhook and Mitemiru event handler; Staging needs test credentials |
| Cash confirmation | `jpy_cash`; operator verifies from order/pickup code | Retain server-side owner checks and audit history |
| Stock and reservations | Product stock/sold/reserved fields and order holds | City and event orders must reserve atomically through the same service |
| Pickup codes and fulfillment | Order-specific code; operator confirmation routes | Do not put a reusable order code or payment authorization in product QR |
| Refunds | Admin refund flow; chain EMUER refund requires the existing contract role | Keep existing permissions and exact-once state transitions |
| Shop/admin permissions | `requireOwner`, owner identity, server-only Firestore writes | City UI is not an authorization boundary; server keeps the final check |

Firestore Rules exclude `mitemiru_*` and `emuer_v2_*` client writes. That restriction must remain.

## Special Quest #002 findings

Source reviewed: `tools/quest-seeds/special-001-002.json`, `backend/quest-completion.js`, City source and current routes.

- **Actual Production participant count:** not available from this repository snapshot; requires read-only access to the live Quest records. No Production read was attempted.
- **Participant limit:** the seed explicitly says `need: 50` is the display-field ceiling, not a 50-person cap; it says there is no first-come cap. The event success criterion is five attendees. Confirm the live Quest record before treating this as current Production state.
- **Total reward budget:** the seed says `budget: 100 EMUER`, while the completion text says `100 EMUER` per completed participant. These values do not establish the currently published Firestore total budget. The authoritative runtime budget is `emuer_v2_guild_quest_budgets/quest:<questId>`; its live row was not read.
- **Per-person reward:** seed text says 100 EMUER. Runtime completion uses the published budget's `perPersonEmuer` value (with a stage-based default only for older budget rows). The live value is unconfirmed.
- **Completion conditions:** the seed requires attendance, three reports (やってみた／つまずいた／気づいた), one wisdom card, and operator review. The Quest-completion route validates the reports, wisdom and owner approval; event attendance still needs an authoritative operator check.
- **Event product-exchange budget:** no live Mitemiru product or event-specific exchange budget was confirmed. Do not infer it from the quest-completion reward budget.
- **On-site check-in:** current seed says the operator confirms attendance. Current City spots are demo entries with no Quest link; no QR-backed attendance implementation was found in the reviewed code paths.
- **Duplicate prevention with City:** no shared City/Quest attendance check was found. Existing per-Quest completion records prevent duplicate completion approvals, but they do not prove event attendance or prevent a City scan from being counted twice.

Do not change any #002 limit, condition or reward in this Phase 0 branch. Live Firestore inspection and owner confirmation are prerequisites for event QR implementation.

## Phase 0 status

- Source-level flag bug: **addressed in branch; tests added, pending execution in a complete checkout/CI**.
- Backend rejection of Production Firebase credentials in Staging mode: **implemented and unit test added**.
- Production Vercel Preview write prevention: **not completed; this branch has an auto-built Preview with Production-bound client config. No writes were tested. External Preview protection/disablement and client config split are required before use or PR review**.
- Staging Auth/Firestore/API/test data: **not provisioned**.
- Mainnet wallet/token tests: **not run and prohibited**.
- Mitemiru dependency inventory: **completed from source; no API/schema migrations performed**.
- #002 live counts and budget: **unverified; no Production data was read or changed**.
- City 3D and movement: **unchanged**.
- Camellia Production code/configuration: **unchanged**.

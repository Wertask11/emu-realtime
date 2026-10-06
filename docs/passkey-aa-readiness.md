# Passkey / Account Abstraction readiness

This change adds Passkeys as an additional SchoolPark login method. Registration requires an already authenticated Firebase account and an existing Passport ID. The credential is attached to that Passport ID; verification issues a Firebase custom token for the identity's existing canonical UID. Passkey flows never call Passport issuance.

## Passkey configuration before activation

The backend remains fail-closed until the explicit activation flag and both exact production origin settings are present. Keep the activation flag off while deploying backend support and Firestore controls:

- `SCHOOLPARK_PASSKEY_ENABLED=true` (set this last, only after backend, Rules, indexes, and TTL are ready)
- `SCHOOLPARK_PASSKEY_RP_ID=schoolpark-emu.vercel.app`
- `SCHOOLPARK_PASSKEY_ORIGIN=https://schoolpark-emu.vercel.app`

Use the actual public SchoolPark hostname if it changes. The backend accepts only a bare HTTPS origin (no path, query, or fragment) whose hostname exactly matches the RP ID. Preview origins are not accepted by this production setting. `/available` returns true only when the explicit flag, valid RP configuration, Firestore Admin, and Firebase Admin are present; all Passkey routes return unavailable while disabled. It cannot remotely prove Firestore Rules/index/TTL deployment, so operational enablement order is mandatory.

The server stores only credential ID, public key, signature counter, transports, a deterministic opaque user handle derived from the Passport ID, device label, and timestamps in server-only `sp_passkeys` records. One-time challenges live briefly in `sp_passkey_challenges`; server validation enforces the five-minute expiry and transactional one-time consumption. `firestore.indexes.json` declares the challenge query index and TTL on `expiresAt`. Apply the index and TTL before enabling the feature so abandoned challenges are garbage-collected. Firestore Rules exclude both collections from browser access. No private key, recovery secret, or passkey secret is stored by SchoolPark.

### Production rollout order

1. Deploy backend code with `SCHOOLPARK_PASSKEY_ENABLED` unset/false; confirm `/api/passkey/available` reports `false` and existing login methods work.
2. Apply Firestore Rules that deny client reads/writes to `sp_passkeys` and `sp_passkey_challenges`.
3. Apply Firestore composite index for `challenge` + `type`; wait until Firestore reports it ready.
4. Enable Firestore TTL for `sp_passkey_challenges.expiresAt`; wait for the TTL policy to become active.
5. Configure the exact RP ID and HTTPS origin in the backend runtime.
6. Run backend smoke tests and verify server-side credential/challenge access with Admin SDK.
7. Set `SCHOOLPARK_PASSKEY_ENABLED=true` last. The frontend reveals Passkey actions only after `/available` reports true.
8. If any infrastructure change is rolled back or compromised, unset the activation flag first; the other Firebase/Google/LINE/email/wallet login methods remain independent.

The account must still have its existing `ches_accounts/{uid}` entry and canonical Firebase Auth user. This prevents a Passkey login from silently creating a replacement Firebase user if the original account was removed.

## Account Abstraction decision

No ERC-4337 EntryPoint / account factory, deployed smart-account implementation, bundler endpoint, paymaster policy, or account recovery model is present in the current repository. Polygon NFT and EMUER flows use existing EOA-based contracts and ethers v5.7.2 in the backend/frontend; the restricted candidate contracts package uses ethers v6.17.0 for deployment tooling. This change therefore does not invent a Smart Account address or change existing wallet behavior.

The preferred evaluation path is an additive ERC-4337 account mapping on the existing Passport identity, with a Safe account implementation as the first candidate because Safe lists Polygon mainnet (chain ID 137), the Safe 4337 module, and the Safe Passkey module. Keep its login Passkey separate from the Smart Account authorization credential. A future WebAuthn signer can be added to the Safe only after a separate account-passkey enrollment, clear consent, verified module deployment/version compatibility, recovery testing, and module-specific security review. Existing EOA addresses remain separate account records and continue to own their current NFTs/EMUER; no asset migration is implied.

Do not approve a production Safe rollout yet. Separate module reports do exist: Safe 4337 v0.2.0 has Ackee Blockchain and OpenZeppelin reviews, and the Passkey module v0.2.1 has a Hats.finance audit competition report with three low-severity findings. However, the supported Polygon 4337 deployment is v0.3.0, so the exact deployed bytecode/version and its corresponding audit/formal verification must be checked; do not infer audit coverage from a module name. Safe's main audit index by itself lists Safe core through v1.4.0 and the Allowance Module, not the newer module versions. Verify factory/module addresses and the complete version matrix before funds or user assets depend on them.

Recovery is unresolved for Polygon: the current Safe supported-network listing for chain 137 shows the 4337, Passkey, and Allowance modules, but not the Recovery Module. Safe's Recovery Module v0.1.0 has audit reports, but that does not establish an official Polygon deployment. A future account must therefore have a tested user-controlled recovery path (for example, a second owner the user controls) or a specifically verified recovery module. The SchoolPark operator must not be the sole recovery authority. Safe's Passkey documentation also warns against making a possibly device-bound passkey the only owner and recommends a rotation/recovery structure.

For infrastructure, keep ERC-4337 JSON-RPC client interfaces swappable. Pimlico documents support for Safe and other account implementations, an Alto bundler, and sponsored paymasters with per-user and per-operation policy limits; this is a provider choice, not a contract requirement. Its current exact commercial rate was not verified here. Alchemy also supports Polygon smart wallets and sponsored transactions, but its Polygon routing requires Gas Manager use through its Wallet/Low-Level Bundler APIs, creating more provider coupling. Its published plans currently list 30M free compute units/month, then $0.525 per million compute units on Pay As You Go; gas sponsorship adds an 8% admin fee and requires preloaded funds. Chain gas remains variable. No bundler or paymaster is configured in this repository. Sponsorship must be limited to allowlisted contract/function calls, per-user and global spend/count caps, time windows, and a kill switch; do not sponsor arbitrary user operations.

The required Passport association should be an additive `web3Accounts` collection/array with fields such as `kind` (`eoa` / `smart_account`), `chainId`, `address`, `implementation`, `deploymentState`, and timestamps. Passport ID stays an application identity and is never used as a blockchain address. Do not write an empty/placeholder Smart Account record before an account is actually deterministically derived from the selected factory and signer. Later AI-agent permissions must use a separate session signer/capability module with contract and function allowlists, spend and time limits, revocation, and user confirmation for purchases; no agent key or permission is present now.

Passport ID remains the durable SchoolPark identity key. The Login Passkey records are keyed back to it, so a future Smart Account mapping can be added to that identity without changing existing Passport IDs or wallet links. Existing wallet login, Google, LINE, and email login remain independent authenticators for the same canonical Firebase user. No production contract deployment, wallet migration, paymaster, or Firestore migration was done.

## Separate follow-up phase: SchoolPark Account Abstraction

Account Abstraction is explicitly outside the current Passkey release. Preserve this readiness assessment without blocking Passkey delivery. The intended identity relationship is:

```text
Passport ID
└── Web3 Accounts
    ├── Existing EOA
    └── Smart Account (future, optional)
```

Safe + ERC-4337 remains the leading candidate, not an implementation decision. Before a separate AA release, verify and approve all of the following:

- Exact Safe account, factory, module versions, Polygon mainnet addresses, and deployed bytecode.
- Audit reports that match those exact deployed versions and addresses; verify the EntryPoint version and address.
- Bundler provider, endpoint, availability, pricing, rate limits, and a provider replacement plan.
- Paymaster choice and a bounded sponsorship policy (allowlisted contract/function, per-user and global caps, time window, monitoring, and kill switch); no unrestricted sponsorship.
- User-controlled recovery and loss scenarios, including device-bound Passkey loss; SchoolPark must not be the sole recovery authority.
- Separate enrollment and consent for a Smart Account Passkey signer. The SchoolPark Login Passkey is not automatically an asset-authorization key.
- How an existing EOA coexists with a Smart Account; no forced migration or asset transfer.
- When to create/deploy a Smart Account and how its address/state is represented as an additive Web3 Account under Passport ID.
- Future Agent scoped permissions: contract/function allowlists, expiry, spend/operation limits, revocation, and per-purchase user approval.

No AA contract, account mapping, bundler, paymaster, recovery module, agent permission, or production migration is part of the current Passkey release.

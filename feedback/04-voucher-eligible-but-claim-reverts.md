# [SDK / Contracts] getPerpVoucherEligibility says eligible: true, but claim() reverts with unknown error 0x3e31dcc2

Severity: major
Area: SDK

## Steps to reproduce
1. Bot EOA `0x2642...3388`, linked to app Wallet 1 via **Link a bot** (Perps), funded with 5 STT on Hideki. No positions, no orders.
2. `client.getPerpVoucherEligibility(marginBank, bot)` -> `{ eligible: true, grantAmount: 1000e18 }`
3. `client.getPerpVoucher(marginBank, bot)` -> `{ claimed: false }`
4. Campaign: window open (2026-09-28 .. 2026-12-28), `claimsRemaining = 370936`.
5. Simulate `claim()` on distributor `0x2ACD9EFdA721450906bfE1bef3edE269636E42C4` at latest block (`node diag_voucher.mjs`).

## Expected
Eligibility and claim agree: if `eligible: true`, the claim succeeds; if the claim would revert,
eligibility returns the reason (e.g. `mainFunded`, `notFlat`).

## Actual
- Simulation reverts with data **`0x3e31dcc2`**. Still unknown in the latest SDK (0.32.1 and 0.32.2 canary).
- The selector is not in the SDK's `contractErrorsAbi` (546 error definitions searched) nor in 4byte.directory,
  so the developer cannot tell why.
- Suspected cause: the account is a bot linked to a main wallet (the docs mention `ClaimantIsMainFunded`
  is not in the SDK error table yet), but its selector `0x1fac9b7d` does not match either.
- The actual on-chain claim tx also reverted (status 0, 22,781 gas): https://explorer.testnet.somnia.network/tokyo/tx/0x42f9b18b7d30935627c200e51b4c402d321a8e8aadf3b5ef4c5614dd06295411
- Re-checked on Oct 27 at block 34,579,139: `eth_call` of `claim()` (selector `0x4e71d92d`) from the bot still reverts with `0x3e31dcc2`, both at `latest` and at the parent block of the tx above.

## Suggested fix
- Add the error behind `0x3e31dcc2` to `contractErrorsAbi` and the published ABIs.
- Make `getPerpVoucherEligibility` check the same rule as `claim()` (for example a linked bot / main-funded account) and return `eligible: false` with the reason.

## Evidence
`node diag_voucher.mjs` output: campaign, eligibility, voucher state and the revert data above.

## Environment
Somnia Tokyo testnet (50383), @somnia-chain/markets-sdk 0.32.1, viem 2.57.10, Node 22, Hideki testnet (50383), 2026-10-24.

# Voucher eligibility says eligible: true but claim() reverts with unknown selector 0x3e31dcc2

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
- Simulation reverts with data **`0x3e31dcc2`**.
- The selector is not in the SDK's `contractErrorsAbi` (546 error definitions searched) nor in 4byte.directory,
  so the developer cannot tell why.
- Suspected cause: the account is a bot linked to a main wallet (the docs mention `ClaimantIsMainFunded`
  is not in the SDK error table yet), but its selector `0x1fac9b7d` does not match either.
- The actual on-chain claim tx (bot nonce 0) also reverted, see #3.

## Evidence
`node diag_voucher.mjs` output: campaign, eligibility, voucher state and the revert data above.

## Environment
@somnia-chain/markets-sdk 0.32.1, viem 2.57.10, Node 22, Hideki testnet (50383), 2026-10-24.

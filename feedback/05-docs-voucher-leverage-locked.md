# [Docs] "Leverage can't be changed while the paper USDso voucher remains" is wrong: it can be changed both down and up

Severity: normal
Area: docs

## Steps to reproduce
1. Join Perps Arena so the wallet holds the 1,000 paper USDso voucher (creditFloor = 1000 USDso).
2. On BTC-PERP, change the leverage setting in the app from 20x to 1x.
3. Read `client.getPerpLeverage({ marginBank, account, pool })` -> `accountMaxLeverageX`.
4. Change it back from 1x to 20x in the app and read it again.

## Expected
Per the docs (Perps (testnet) > Margin & Liquidations > Paper USDso):
"Your leverage setting can't be changed while it remains."
So both changes should be rejected while `creditFloor > 0`.

## Actual
Both changes go through on chain while the voucher is still active:

| time (UTC) | accountMaxLeverageX | creditFloor | voucherLeverageCapX |
|---|---|---|---|
| 06:44:51 | **1** (after 20x -> 1x) | 1000 USDso | 20 |
| 06:47:09 | **20** (after 1x -> 20x) | 1000 USDso | 20 |

The SDK's own `PerpLeverage` docs describe a different rule: while a voucher is active, the voucher cap
(`voucherLeverageCapX`, 20) bounds new increases and a stricter user setting still wins. That matches what happens.
The user-facing doc is the one that is wrong / outdated, and it can make traders think they are stuck at a leverage they chose by mistake.

## Suggested fix
Replace the sentence with something like: "While the voucher remains, increases are capped at the voucher
leverage cap (currently 20x). You can still lower or raise your own setting within that cap."

## Evidence
`node leverage_check.mjs` output at both times (above). Wallet `0xbECd3f4f8Fe8a0A69AC7c04c193aB49a47375c2b`, voucher expiresAt 2026-11-07.

## Environment
Somnia Tokyo testnet (50383). app.testnet.dreamdex.io, @somnia-chain/markets-sdk 0.32.1, Hideki testnet (50383), 2026-10-24.

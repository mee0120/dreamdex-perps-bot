# [SDK] No perp operator methods or ABI for linked bots (placeOrderFor / cancelOrderFor / reduceOrderFor); cancelOrderFor is undocumented

Severity: normal
Area: SDK

## Steps to reproduce
1. Link a bot to Wallet 1 (Wallet menu > Link a bot > Perps). The docs say the bot "can place, cancel and reduce orders for that wallet".
2. Try to do that with `@somnia-chain/markets-sdk` 0.32.1:
   - `trader.placePerpOrder` / `cancelOrder` only act on the **signer's own** account (no `owner` parameter).
   - The exported `perpPoolWriteAbi` contains `placeOrder, cancelOrder, updateFunding, marginBank` - **no** `placeOrderFor`, `cancelOrderFor`, `reduceOrderFor`.
3. Look for `cancelOrderFor` in the docs: only `placeOrderFor` is shown (Perps on testnet > Raw and operator calls). Its signature is not documented.
4. In the SDK, `spot/operatorGrants.js` exports `CANCEL_ORDER_FOR_SELECTOR = "0xe37b444b"` with the comment
   "SPOT-ONLY: the registry gates SpotPool's operator entry points (placeOrderFor and friends)".

## Expected
The bot workflow the app advertises (Link a bot -> bot trades your perps wallet) is supported by the SDK:
e.g. `trader.placePerpOrderFor({ owner, ... })`, `cancelPerpOrderFor`, `reducePerpOrderFor`, or at least the
three functions in an exported ABI and in the docs.

## Actual
Every bot builder has to hand-write the ABI. `cancelOrderFor` had to be reverse-engineered from the spot selector:
`0xe37b444b == cancelOrderFor(address owner, uint128 orderId)`. It works on PerpPool:

- Cancel tx (status success, `OrderCancelled`): https://explorer.testnet.somnia.network/tokyo/tx/0x3a8c41a39a55029d0abcc4537a2bfc93544ffd5e8d9d6ff901907976c69cc597
- Place tx via hand-written `placeOrderFor`: https://explorer.testnet.somnia.network/tokyo/tx/0x54a612fa78799d128d1c8fc503fcfb5e6d8efbf6a56d9afd054a45083b8f8789

Checked again on Oct 27: still missing in 0.32.1 and in 0.32.2 canary (only mentioned in code comments).

The "SPOT-ONLY" comment is misleading for perps, where Link a bot uses exactly these entry points.

## Suggested fix
Add `placePerpOrderFor` / `cancelPerpOrderFor` / `reducePerpOrderFor` (or an `owner` option) to the Trader,
export the operator ABI fragments, and document `cancelOrderFor` / `reduceOrderFor` next to `placeOrderFor`.

## Evidence
`cancel_for.mjs` and `order_for.mjs` in this repo (hand-written ABI), the two tx above.

## Environment
Somnia Tokyo testnet (50383). @somnia-chain/markets-sdk 0.32.1, viem 2.57.10, Node 22, Hideki testnet (50383), 2026-10-24.

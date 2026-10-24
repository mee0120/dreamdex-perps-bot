# dreamdex-perps-bot — Position Guard

**Position Guard** watches the perp positions you open by hand in the dreamDEX app and protects them 24/7:
stop-loss, take-profit and an account-health brake that de-risks before liquidation.

A bot linked with **Link a bot** cannot arm exchange-side TP/SL (only the wallet itself can).
So the guard watches the mark price itself and closes positions with `placeOrderFor`.

Bot experiments on **dreamDEX perps** (Somnia **Hideki** testnet, chain ID 50383) using
[`@somnia-chain/markets-sdk`](https://www.npmjs.com/package/@somnia-chain/markets-sdk) 0.32.1 and viem.

Built for the **dreamDEX Perps Builder Bounty** (Feedback + MVP tracks).

## Status

| Step | Result |
|---|---|
| Read all 21 perp markets (mark, funding, OI, tick/lot sizes) | ✅ `check.mjs` |
| Bot key generated server-side, linked to an app wallet via **Link a bot** | ✅ `keygen.mjs` |
| Bot places a perp order **for** the linked wallet (`placeOrderFor`) | ✅ `order_for.mjs` |
| Bot cancels the linked wallet's resting order (`cancelOrderFor`) | ✅ `cancel_for.mjs` |
| **Position Guard**: watches a manual position and auto-closes it on stop-loss | ✅ `guard.mjs` |
| **Position Guard**: health brake reduces the largest of several positions by 50% | ✅ `guard.mjs` |
| Bot claims its own paper USDso voucher | ❌ reverts - see [feedback/](feedback/) |

### First live order on testnet

- Tx: [`0x54a612fa…8f8789`](https://explorer.testnet.somnia.network/tokyo/tx/0x54a612fa78799d128d1c8fc503fcfb5e6d8efbf6a56d9afd054a45083b8f8789) (status: success, block 31652420)
- Market: BTC-PERP, resting LIMIT BUY 0.00013 BTC @ 72,731.3 (~10% under mark, so it rests)
- Owner (app wallet): `0xbECd3f4f8Fe8a0A69AC7c04c193aB49a47375c2b`
- Bot (operator): `0x26421030A92Bb1e96C6E0137b004AA583b463388`
- Events: `OrderPlaced` → `OrderRested`

### Position Guard closing a manual position (live)

1. Opened BTC-PERP LONG 0.00123 BTC by hand in the app (Market, 100 USDso).
2. `node guard.mjs --live` with `GUARD_SL_PCT=0.05`
3. Guard log:
   ```
   health=Healthy equity/MM=402.79x  BTC L -0.087%
   SENT BTC-PERP SELL 0.00123 @ <= 80285.1 (100% of position) - stop-loss -0.087% <= -0.05%
   status=success events=OpenInterestUpdated,OrderFilled,OrderPlaced
   ```
4. Tx: [`0x57884a8d…41cc1b`](https://explorer.testnet.somnia.network/tokyo/tx/0x57884a8d041500b7704049adfd51a22d17dd8b8335fd6871cf8a2ab72341cc1b) — position fully closed, Discord alert sent.

### Health brake on two positions (live)

1. Opened BTC-PERP LONG 0.00123 and ETH-PERP LONG 0.0209 by hand. The running guard announced both on Discord:
   `👀 Now guarding: BTC-PERP LONG 0.00123 @ 80882.50 | SL 79264.85 | TP off | health brake < 1.5x`
2. Forced the brake with a test threshold: `GUARD_SL_PCT=0 GUARD_MIN_HEALTH=1000 node guard.mjs --live --once`
3. Guard log:
   ```
   health=Healthy equity/MM=268.59x  ETH L -0.113% | BTC L -0.244%
   SENT BTC-PERP SELL 0.00061 @ <= 80281.8 (50% of position) - account health 268.59x < 1000x
   status=success events=OpenInterestUpdated,OrderFilled,OrderPlaced
   ```
   It picked the **largest** position (BTC ~99 USDso vs ETH ~50 USDso) and sold half, rounded down to the lot size.
4. Tx: [`0x185d212b…4a9f85a`](https://explorer.testnet.somnia.network/tokyo/tx/0x185d212b5bcfece829a4ad961dd720b5f102e9550c3b32faf2d6799cf4a9f85a). The always-on guard then reported
   `🔄 Position changed: BTC-PERP LONG 0.00062`.

## Alerts

| Alert | When |
|---|---|
| 👀 Now guarding | a new position appears (shows entry, SL / TP trigger prices, health brake) |
| 🔄 Position changed | the size changes (partial close, add) |
| ✅ Closed / Would close | the guard sent (or, in dry run, would send) a closing order, with the explorer link |
| ⚠️ Could not close | the simulation reverted - nothing was sent, reason included |
| ✋ Stopped guarding | the position is gone |

The log only writes when the position set or health bucket changes, plus a heartbeat every `GUARD_HEARTBEAT_MIN` (10) minutes.

## How the guard decides

Every `GUARD_INTERVAL_SEC` (default 15 s) it reads, for the owner wallet:
`getAccountHealth` (equity vs maintenance margin) and, per market, `getPerpPosition` + `getPerpPositionAnalytics` (mark, notional).

| Rule | Trigger (env) | Action |
|---|---|---|
| Account health | equity / maintenance margin < `GUARD_MIN_HEALTH` (1.5) | reduce the **largest** position by `GUARD_REDUCE_FRACTION` (50%) |
| Stop-loss | adverse move from entry ≥ `GUARD_SL_PCT` % | close the position |
| Take-profit | favourable move from entry ≥ `GUARD_TP_PCT` % | close the position |

Each close is an opposite-side **IOC** order sized ≤ the position (never flips it), priced through the book
with `GUARD_SLIPPAGE_PCT`, **simulated at the latest block before sending**, followed by a per-market cooldown.
Alerts go to **Discord** (`DISCORD_WEBHOOK_URL`) and/or **Telegram** (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`).
Without `--live` it only logs and alerts what it *would* do.

## Setup

```bash
npm install
node keygen.mjs          # writes .env (chmod 600), prints the bot address only
# In the dreamDEX app: Wallet > Link a bot > paste bot address > Perps > "Send it 5 STT for gas" > Add bot
# Put the linked app wallet address into OWNER_ADDRESS in .env
node check.mjs           # list perp markets (read-only)
node balance.mjs         # STT on Hideki vs Shannon for bot and owner
node order_for.mjs       # simulate the order (dry run)
node order_for.mjs --send
node guard_status.mjs    # positions, liquidation price, distance, account health
node guard.mjs --once    # one dry-run check
node guard.mjs --live    # run the guard for real (see guard.service for systemd)
```

`order_for.mjs` checks `getMaxPerpOrderSize` for the owner, rounds price/qty to tick/lot,
**simulates `placeOrderFor` at the latest block first** (so a revert shows its reason),
then sends with a 10M gas limit and decodes `OrderPlaced` / `OrderRested` from the receipt.

## Feedback found so far

| # | Title | Severity | Area |
|---|---|---|---|
| 1 | [App "Send" to a bot address silently withdraws to Shannon, not Hideki](feedback/01-send-goes-to-shannon.md) | major | app |
| 2 | [SDK reports "account does not exist" as "claim reverted: Missing or invalid parameters"](feedback/02-sdk-misleading-no-gas-error.md) | normal | SDK |
| 3 | [Revert reasons cannot be decoded: node refuses historical eth_call](feedback/03-revert-decode-historical-state.md) | major | SDK |
| 4 | [Voucher eligibility says `eligible: true` but `claim()` reverts with unknown selector 0x3e31dcc2](feedback/04-voucher-eligible-but-claim-reverts.md) | major | SDK |
| 5 | [Docs say leverage can't be changed while the voucher remains, but it can](feedback/05-docs-voucher-leverage-locked.md) | normal | docs |
| 6 | [SDK has no perp operator methods/ABI for linked bots; cancelOrderFor is undocumented](feedback/06-sdk-no-perp-operator-methods.md) | normal | SDK |

## Safety

- The private key only lives in `.env` on the server (`chmod 600`) and is never printed or committed.
- A linked bot can place / cancel / reduce orders for the owner wallet but cannot withdraw or send funds.

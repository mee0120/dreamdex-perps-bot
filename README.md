# dreamdex-perps-bot — Position Guard

**Position Guard** watches the perp positions you open by hand in the dreamDEX app and protects them 24/7:
stop-loss, take-profit and an account-health brake that de-risks before liquidation.

A bot linked with **Link a bot** cannot arm exchange-side TP/SL (only the wallet itself can).
So the guard watches the mark price itself and closes positions with `placeOrderFor`.

Bot experiments on **dreamDEX perps** (Somnia **Hideki** testnet, chain ID 50383) using
[`@somnia-chain/markets-sdk`](https://www.npmjs.com/package/@somnia-chain/markets-sdk) 0.32.1 and viem.

Built for the **dreamDEX Perps Builder Bounty** (Feedback + MVP tracks).

## Concept

**Who it is for:** traders who open perps by hand in the dreamDEX app (or on a phone) and cannot watch the screen all day.

**The problem:** on dreamDEX a bot linked with **Link a bot** can place, cancel and reduce orders, but it cannot arm stop orders on the exchange.
The Builder Session (Oct 27) put it plainly: with a trading key, take-profit and stop-loss "are watched by the bot, not armed on the exchange"
and "act only while the bot runs". So a manual position has no protection unless something keeps watching it.

**What Position Guard adds:** a watcher that is always on and protects positions *you* opened, in every market at once:

- stop-loss and take-profit per position, closed with an IOC order through the book (never flips the position)
- an account-health brake that halves the largest position before maintenance margin is reached
- Discord and Telegram alerts when it starts guarding, when a position changes, and when it closes or cannot close

The official dreamBot templates set TP/SL for the bot's *own* trades. Position Guard is the other half: it guards what a human opened.

**Core loop:** open a position in the app -> the guard announces "Now guarding" with the trigger prices -> it closes on SL, TP or the health brake -> you get the alert and the tx link -> open the next trade. Nothing to configure per trade.

**Why it spreads:** every perps trader has been liquidated or stopped out while away from the screen. The guard is one process, one `.env` and a linked bot key that cannot withdraw funds, so it is easy to share and safe to try.

## Status

| Step | Result |
|---|---|
| Read all 21 perp markets (mark, funding, OI, tick/lot sizes) | ✅ `check.mjs` |
| Bot key generated server-side, linked to an app wallet via **Link a bot** | ✅ `keygen.mjs` |
| Bot places a perp order **for** the linked wallet (`placeOrderFor`) | ✅ `order_for.mjs` |
| Bot cancels the linked wallet's resting order (`cancelOrderFor`) | ✅ `cancel_for.mjs` |
| **Position Guard**: watches a manual position and auto-closes it on stop-loss | ✅ `guard.mjs` |
| **Position Guard**: health brake reduces the largest of several positions by 50% | ✅ `guard.mjs` |
| **Position Guard**: take-profit closes a SHORT (buy-back) | ✅ `guard.mjs` |
| **Position Guard**: unattended 2% stop-losses closed ETH and BTC during a real market drop | ✅ `guard.mjs` |
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

### Take-profit on a short (live)

Three positions guarded at once (SOL SHORT, ETH LONG, BTC LONG); the short reached the TP first and was bought back:
```
health=Healthy equity/MM=267.28x  SOL S +0.119% | ETH L -0.110% | BTC L -0.223%
NOW GUARDING SOL-PERP SHORT 0.49 @ 102.09 | SL off | TP 102.07 | health brake < 1.5x
SENT SOL-PERP BUY 0.49 @ <= 102.48 (100% of position) - take-profit +0.119% >= 0.02%
status=success events=OpenInterestUpdated,OrderFilled,OrderPlaced
STOPPED GUARDING SOL-PERP (position closed)
```
Tx: [`0x18d9b73f…85c9253`](https://explorer.testnet.somnia.network/tokyo/tx/0x18d9b73f69480e596e5c60e5436eab0d1022645324e656305608bb5c785c9253)

So all three rules - stop-loss, health brake, take-profit - have closed real testnet positions, on both long and short.

### Unattended stop-losses with real thresholds (live)

The tests above used tiny test thresholds. After them, the leftover ETH and BTC longs were left open with
the guard running unattended on production-style settings (`GUARD_SL_PCT=2`). The market fell and the guard closed
both on its own, about an hour apart, with nobody watching:

```
[2026-10-24 14:18:29 UTC] SENT ETH-PERP SELL 0.0209 @ <= 2318.87 (100% of position) - stop-loss -2.023% <= -2%
                          status=success events=OpenInterestUpdated,OrderFilled,OrderPlaced
[2026-10-24 15:19:44 UTC] SENT BTC-PERP SELL 0.00062 @ <= 78827.5 (100% of position) - stop-loss -2.051% <= -2%
                          status=success events=OpenInterestUpdated,OrderFilled,OrderPlaced
```

- ETH: [`0x810eb754…16742b4`](https://explorer.testnet.somnia.network/tokyo/tx/0x810eb75445584bc43b485b474fdc2269a3efeda784ffe496288035c8b16742b4)
- BTC: [`0x0cbabc3d…8f0bd`](https://explorer.testnet.somnia.network/tokyo/tx/0x0cbabc3d84390cc721570baf05d2123b799c24e001f6fc869f90e0cf18d5f0bd)

Both fired within ~0.05% of the 2% trigger, so a 15 s check interval is enough to keep the realized loss
close to the configured stop. The same process has been running since 2026-10-24 and still writes a heartbeat every 10 minutes
(`health=Healthy ... no positions`), so the account stays guarded even while flat.

## Alerts

| Alert | When |
|---|---|
| 👀 Now guarding | a new position appears (shows entry, SL / TP trigger prices, health brake) |
| 🔄 Position changed | the size changes (partial close, add) |
| ✅ Closed / Would close | the guard sent (or, in dry run, would send) a closing order, with the explorer link |
| ⚠️ Could not close | the simulation reverted - nothing was sent, reason included |
| ✋ Stopped guarding | the position is gone |

Both channels are verified live: Discord via webhook, Telegram via a bot (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`) -
the same "Now guarding" alert arrives on a phone within one check interval.

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
| 1 | [[App] Wallet "Send" never shows the destination network: STT sent to a bot lands on Shannon, not Tokyo](feedback/01-send-goes-to-shannon.md) | normal | app |
| 2 | [[SDK] A send from an account with no gas surfaces as "claim reverted: Missing or invalid parameters"](feedback/02-sdk-misleading-no-gas-error.md) | normal | SDK |
| 4 | [[SDK / Contracts] getPerpVoucherEligibility says eligible: true, but claim() reverts with unknown error 0x3e31dcc2](feedback/04-voucher-eligible-but-claim-reverts.md) | major | SDK / contracts |
| 5 | [[Docs] Leverage can be changed while the paper USDso voucher remains, unlike the docs say](feedback/05-docs-voucher-leverage-locked.md) | normal | docs |
| 6 | [[SDK] No perp operator methods or ABI for linked bots; cancelOrderFor is undocumented](feedback/06-sdk-no-perp-operator-methods.md) | normal | SDK |

#3 (historical `eth_call` refused by the node) was withdrawn on Oct 27: the replay at the parent block works now, so it no longer reproduces.


## Safety

- The private key only lives in `.env` on the server (`chmod 600`) and is never printed or committed.
- A linked bot can place / cancel / reduce orders for the owner wallet but cannot withdraw or send funds.

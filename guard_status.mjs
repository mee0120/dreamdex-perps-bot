// Position Guard - step 1 (read-only)
// Shows every open perp position of the owner wallet with its liquidation price
// and how far the mark is from it, plus the account's margin health.
//
// Usage: node guard_status.mjs

import { readFileSync } from "fs"
import { formatUnits } from "viem"
import { SOMNIA_HIDEKI_TESTNET_ADDRESSES, SomniaMarkets } from "@somnia-chain/markets-sdk"
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains"

const env = Object.fromEntries(
  readFileSync(new URL(".env", import.meta.url), "utf8")
    .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
)
const owner = process.env.OWNER || env.OWNER_ADDRESS
if (!owner) throw new Error("OWNER_ADDRESS missing in .env")

const markets = new SomniaMarkets({
  chain: hidekiTestnet,
  indexerUrl: "https://hideki-dev.smk.somnia.host/v1/graphql",
  addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
})

const fmt = (v, d, digits = 4) => (v === null || v === undefined ? "-" : Number(formatUnits(v, d)).toFixed(digits))
const pct = (num, den) => (den === 0n ? "-" : (Number((num * 1_000_000n) / den) / 10_000).toFixed(2) + "%")

const perps = await markets.client.listPerpMarkets()
const bank = perps[0].marginBank
console.log(`owner: ${owner}`)

// account health (cross margin)
const h = await markets.client.getAccountHealth(bank, owner)
console.log(`account: status=${h.marginStatus} equity=${fmt(h.equity, 18, 2)} IM=${fmt(h.imReq, 18, 2)} MM=${fmt(h.mmReq, 18, 2)} USDso`)
if (h.mmReq > 0n) console.log(`         equity / maintenance = ${(Number((h.equity * 100n) / h.mmReq) / 100).toFixed(2)}x  (liquidation below 1.00x)`)

// positions: one chain read per market
let open = 0
for (const m of perps) {
  const ref = { marginBank: m.marginBank, account: owner, pool: m.poolAddress }
  const pos = await markets.client.getPerpPosition(ref)
  if (pos.size === 0n) continue
  open++
  const side = pos.size > 0n ? "LONG " : "SHORT"
  const a = await markets.client.getPerpPositionAnalytics(ref)
  const liq = await markets.client.getLiquidationPrice(ref)
  const mark = a.priceable ? a.markPrice : (await markets.client.getPerpState(m.poolAddress)).markPrice
  const abs = pos.size < 0n ? -pos.size : pos.size
  console.log(`\n${m.baseSymbol}-PERP ${side} ${fmt(abs, m.baseDecimals, 6)} ${m.baseSymbol}`)
  console.log(`  entry=${fmt(pos.avgEntryPrice, m.quoteDecimals, 2)} mark=${fmt(mark, m.quoteDecimals, 2)} liq=${fmt(liq, m.quoteDecimals, 2)}`)
  if (liq && mark > 0n) {
    const dist = pos.size > 0n ? mark - liq : liq - mark
    console.log(`  distance to liquidation: ${pct(dist, mark)} of mark`)
  }
  if (a.priceable) {
    console.log(`  uPnL=${fmt(a.unrealizedPnl, 18, 2)} funding owed=${fmt(a.accruedFunding, 18, 4)} notional=${fmt(a.notional, 18, 2)} USDso`)
  } else {
    console.log("  (mark feed stale - analytics not priceable)")
  }
}
if (!open) console.log("\nno open perp positions (resting orders are not positions)")
process.exit(0)

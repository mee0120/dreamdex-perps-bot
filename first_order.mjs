// dreamDEX perps testnet: first order from the bot key
//
// 1. Loads PRIVATE_KEY from .env (never printed)
// 2. Claims the 1,000 paper USDso voucher for the bot account if eligible
// 3. Places one small resting LIMIT BUY on BTC-PERP, ~10% below mark (won't fill)
// 4. Cancels nothing - leave it resting so it shows on the book; run cancel later
//
// Usage: node first_order.mjs            (dry run: prints the plan, sends nothing)
//        node first_order.mjs --send     (actually sends transactions)

import { readFileSync } from "fs"
import { formatUnits } from "viem"
import { SOMNIA_HIDEKI_TESTNET_ADDRESSES, SomniaMarkets } from "@somnia-chain/markets-sdk"
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains"

const SEND = process.argv.includes("--send")
const SYMBOL = process.env.SYMBOL || "BTC"
const DISCOUNT = 0.9 // limit price = mark * 0.9 -> rests on the book, does not fill

// ---- .env ----
const env = Object.fromEntries(
  readFileSync(new URL(".env", import.meta.url), "utf8")
    .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
)
if (!env.PRIVATE_KEY) throw new Error("PRIVATE_KEY missing in .env")

const json = (v) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2)
const big = (x) => (x === null || x === undefined ? null : BigInt(x))
const floorTo = (v, step) => (step > 0n ? (v / step) * step : v)
const ceilTo = (v, step) => (step > 0n ? ((v + step - 1n) / step) * step : v)

const markets = new SomniaMarkets({
  chain: hidekiTestnet,
  indexerUrl: "https://hideki-dev.smk.somnia.host/v1/graphql",
  addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
  privateKey: env.PRIVATE_KEY,
})
const account = markets.walletAddress
console.log("bot account:", account)

// ---- market ----
const perps = await markets.client.listPerpMarkets()
const m = perps.find((x) => x.baseSymbol === SYMBOL)
if (!m) throw new Error(`market ${SYMBOL} not found`)

const mark = big(m.markPrice) ?? big(m.lastPrice)
const tick = big(m.tickSize) ?? 0n
const lot = big(m.lotSize) ?? 0n
const minQ = big(m.minQuantity) ?? lot
if (!mark) throw new Error("no mark price on market row")

const price = floorTo((mark * BigInt(Math.round(DISCOUNT * 1000))) / 1000n, tick)
const quantity = ceilTo(minQ, lot)

console.log(`market: ${SYMBOL}-PERP pool=${m.poolAddress}`)
console.log(`mark=${formatUnits(mark, m.quoteDecimals)}  limit=${formatUnits(price, m.quoteDecimals)}  qty=${formatUnits(quantity, m.baseDecimals)} ${SYMBOL}`)

// ---- voucher ----
const elig = await markets.client.getPerpVoucherEligibility(m.marginBank, account)
console.log("voucher eligibility:", json(elig))

// ---- size check ----
const max = await markets.client.getMaxPerpOrderSize({
  pool: m.poolAddress, marginBank: m.marginBank, account, isBid: true, price,
})
console.log("max order size check:", json(max))

if (!SEND) {
  console.log("\nDRY RUN - nothing sent. Re-run with --send to claim voucher (if eligible) and place the order.")
  process.exit(0)
}

if (elig?.eligible) {
  console.log("\nclaiming 1,000 paper USDso voucher...")
  const r = await markets.trader.claimPerpVoucher({ marginBank: m.marginBank })
  console.log("claim result:", json(r))
}

// re-check after claim
const max2 = await markets.client.getMaxPerpOrderSize({
  pool: m.poolAddress, marginBank: m.marginBank, account, isBid: true, price,
})
if (!max2.priceable) throw new Error("mark price is stale - try again later")
if (!max2.placeable || quantity > big(max2.maxQuantity)) {
  throw new Error(`order not placeable: limitedBy=${max2.limitedBy}`)
}

console.log("\nplacing resting LIMIT BUY...")
const res = await markets.trader.placePerpOrder({ pool: m.poolAddress, isBid: true, price, quantity })
console.log("order result:", json(res))
console.log("\nExplorer: https://explorer.testnet.somnia.network/tokyo (search the tx hash above)")
process.exit(0)

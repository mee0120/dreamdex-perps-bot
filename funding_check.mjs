// Compare what the app header shows (MARK / ORACLE / LAST FUNDING · countdown)
// with what the chain and the SDK report, at the same moment. Read-only.
//
// Usage: node funding_check.mjs          (BTC)
//        SYMBOL=ETH node funding_check.mjs

import { formatUnits } from "viem"
import { SOMNIA_HIDEKI_TESTNET_ADDRESSES, SomniaMarkets } from "@somnia-chain/markets-sdk"
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains"

const SYMBOL = process.env.SYMBOL || "BTC"
const markets = new SomniaMarkets({
  chain: hidekiTestnet,
  indexerUrl: "https://hideki-dev.smk.somnia.host/v1/graphql",
  addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
})
const m = (await markets.client.listPerpMarkets()).find((x) => x.baseSymbol === SYMBOL)
const st = await markets.client.getPerpState(m.poolAddress)
const prem = await markets.client.getPerpFundingPremium(m.poolAddress)

const px = (v) => Number(formatUnits(v, m.quoteDecimals)).toFixed(2)
const pct18 = (v, digits = 4) => (Number(formatUnits(v, 18)) * 100).toFixed(digits) + "%"
const now = Math.floor(Date.now() / 1000)
const mmss = (s) => (s < 0 ? "-" : "") + `${String(Math.floor(Math.abs(s) / 60)).padStart(2, "0")}:${String(Math.abs(s) % 60).padStart(2, "0")}`
const jst = (unix) => new Date(Number(unix) * 1000 + 9 * 3600 * 1000).toISOString().slice(11, 19) + " JST"

console.log(`[${jst(now)}] ${SYMBOL}-PERP  (compare with the app header right now)`)
console.log("\n-- chain (getPerpState) --")
console.log(`  MARK  (EMA-smoothed)          ${px(st.markPrice)}   markPriceOk=${st.markPriceOk}`)
console.log(`  ORACLE/index                  ${px(st.indexPrice)}   updated ${now - Number(st.indexUpdatedAt)}s ago`)
console.log(`  fundingRate (per ${st.fundingWindowSec / 3600}h window)   ${pct18(st.fundingRate)}`)
console.log(`  -> charged per ${st.fundingIntervalSec / 60}min settlement  ${pct18(st.fundingRate / BigInt(Math.round(st.fundingWindowSec / st.fundingIntervalSec)))}`)
console.log(`  -> annualized                 ${(Number(formatUnits(st.fundingRate, 18)) * (365 * 24 * 3600 / st.fundingWindowSec) * 100).toFixed(1)}%`)
console.log(`  last settlement               ${jst(st.lastFundingUpdateAt)}  (${mmss(now - Number(st.lastFundingUpdateAt))} ago)`)
console.log(`  next settlement due           ${jst(st.nextFundingAt)}  (in ${mmss(Number(st.nextFundingAt) - now)})`)
console.log(`  open interest                 ${formatUnits(st.openInterest, m.baseDecimals)} ${SYMBOL}`)
console.log("\n-- premium (getPerpFundingPremium) --")
console.log(`  timeWeightedPremium (next charge, pre-clamp)  ${pct18(prem.timeWeightedPremium)}   armed=${prem.armed}`)
console.log(`  lastObservedPremium (instant)                 ${pct18(prem.lastObservedPremium)}`)
console.log("\n-- indexer market row (listPerpMarkets) --")
console.log(`  markPrice ${m.markPrice ? px(BigInt(m.markPrice)) : "-"}  indexPrice ${m.indexPrice ? px(BigInt(m.indexPrice)) : "-"}  fundingRate ${m.fundingRate ? pct18(BigInt(m.fundingRate)) : "-"}`)
console.log(`  markPriceUpdatedAt ${m.markPriceUpdatedAt ?? "-"}  fundingUpdatedAt ${m.fundingUpdatedAt ?? "-"}  openInterest ${m.openInterest ? formatUnits(BigInt(m.openInterest), m.baseDecimals) : "-"}`)
process.exit(0)

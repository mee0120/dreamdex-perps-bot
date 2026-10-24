// Read the owner's leverage settings for one market (read-only).
// Used to check the docs claim "Your leverage setting can't be changed while
// the paper USDso voucher remains".
//
// Usage: node leverage_check.mjs          (BTC)
//        SYMBOL=ETH node leverage_check.mjs

import { readFileSync } from "fs"
import { formatUnits } from "viem"
import { SOMNIA_HIDEKI_TESTNET_ADDRESSES, SomniaMarkets } from "@somnia-chain/markets-sdk"
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains"

const env = Object.fromEntries(
  readFileSync(new URL(".env", import.meta.url), "utf8")
    .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
)
const owner = env.OWNER_ADDRESS
const SYMBOL = process.env.SYMBOL || "BTC"
const markets = new SomniaMarkets({
  chain: hidekiTestnet,
  indexerUrl: "https://hideki-dev.smk.somnia.host/v1/graphql",
  addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
})
const m = (await markets.client.listPerpMarkets()).find((x) => x.baseSymbol === SYMBOL)
const ref = { marginBank: m.marginBank, account: owner, pool: m.poolAddress }
const lev = await markets.client.getPerpLeverage(ref)
const voucher = await markets.client.getPerpVoucher(m.marginBank, owner)

console.log(`[${new Date().toISOString()}] ${SYMBOL}-PERP owner=${owner}`)
console.log(`  accountMaxLeverageX (your setting, 0 = unset): ${lev.accountMaxLeverageX}`)
console.log(`  marketMaxLeverage: ${Number(lev.marketMaxLeverageBps) / 10000}x   protocolMax: ${lev.protocolMaxLeverageX}x`)
console.log(`  creditFloor (voucher still active if > 0): ${formatUnits(lev.creditFloor, 18)} USDso`)
console.log(`  voucherLeverageCapX: ${lev.voucherLeverageCapX ?? "-"}   voucherMarketAllowed: ${lev.voucherMarketAllowed ?? "-"}`)
console.log(`  voucher: claimed=${voucher?.claimed} floor=${voucher ? formatUnits(voucher.floor, 18) : "-"} expiresAt=${voucher?.expiresAt ? new Date(Number(voucher.expiresAt) * 1000).toISOString() : "-"}`)
process.exit(0)

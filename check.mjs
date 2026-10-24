// Read-only: list all dreamDEX perp markets on the Hideki testnet (no key needed)
import { SOMNIA_HIDEKI_TESTNET_ADDRESSES, SomniaMarkets } from "@somnia-chain/markets-sdk"
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains"

const markets = new SomniaMarkets({
  chain: hidekiTestnet,
  indexerUrl: "https://hideki-dev.smk.somnia.host/v1/graphql",
  addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
})

const perps = await markets.client.listPerpMarkets()
console.log(`perp markets: ${perps.length}`)
for (const m of perps) {
  console.log(`  ${m.baseSymbol}  baseDecimals=${m.baseDecimals}  quoteDecimals=${m.quoteDecimals}  pool=${m.poolAddress}`)
}
console.log("\nmarket row fields:")
console.log(Object.keys(perps[0]).join(", "))
process.exit(0)

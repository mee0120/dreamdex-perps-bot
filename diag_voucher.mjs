// Diagnose why claimPerpVoucher reverted.
// Read-only: sends nothing. Simulates claim() at the LATEST block (the node
// refuses historical state, which is why the SDK could not decode the revert).
//
// Usage: node diag_voucher.mjs

import { readFileSync } from "fs"
import { createPublicClient, http, decodeErrorResult, formatUnits } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { SOMNIA_HIDEKI_TESTNET_ADDRESSES, SomniaMarkets, contractErrorsAbi } from "@somnia-chain/markets-sdk"
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains"

const env = Object.fromEntries(
  readFileSync(new URL(".env", import.meta.url), "utf8")
    .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
)
const bot = privateKeyToAccount(env.PRIVATE_KEY).address
const json = (v) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2)

const markets = new SomniaMarkets({
  chain: hidekiTestnet,
  indexerUrl: "https://hideki-dev.smk.somnia.host/v1/graphql",
  addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
})
const rpc = createPublicClient({ chain: hidekiTestnet, transport: http("https://api.hideki2.infra.testnet.somnia.network") })

const perps = await markets.client.listPerpMarkets()
const btc = perps.find((m) => m.baseSymbol === "BTC")
const bank = btc.marginBank

console.log("bot:", bot)
console.log("nonce (txs sent):", await rpc.getTransactionCount({ address: bot }))

const campaign = await markets.client.getPerpVoucherCampaign(bank)
console.log("\n== campaign")
console.log(json(campaign))
if (campaign) {
  const now = BigInt(Math.floor(Date.now() / 1000))
  console.log(`window open now? ${campaign.startsAt <= now && now < campaign.endsAt}  (startsAt=${new Date(Number(campaign.startsAt) * 1000).toISOString()}, endsAt=${new Date(Number(campaign.endsAt) * 1000).toISOString()})`)
  console.log(`budget: ${formatUnits(campaign.budgetRemaining, 18)} USDso, claimsRemaining=${campaign.claimsRemaining}`)
}

console.log("\n== eligibility (SDK)")
console.log(json(await markets.client.getPerpVoucherEligibility(bank, bot)))

console.log("\n== voucher state for bot")
console.log(json(await markets.client.getPerpVoucher(bank, bot)))

const distributor = campaign?.distributor ?? "0x2ACD9EFdA721450906bfE1bef3edE269636E42C4"
console.log(`\n== simulate claim() at latest block  (distributor=${distributor})`)
try {
  await rpc.call({ account: bot, to: distributor, data: "0x4e71d92d" })
  console.log("simulation: claim() would SUCCEED now")
} catch (e) {
  const data = e?.data ?? e?.cause?.data ?? e?.walk?.((x) => x?.data)?.data
  console.log("simulation: claim() REVERTS")
  console.log("  details:", e.details || e.shortMessage)
  console.log("  raw data:", data)
  if (data && data !== "0x") {
    try {
      const d = decodeErrorResult({ abi: contractErrorsAbi, data })
      console.log("  decoded:", d.errorName, json(d.args ?? []))
    } catch {
      console.log("  decoded: (selector not in SDK error table)", String(data).slice(0, 10))
    }
  }
}
process.exit(0)
